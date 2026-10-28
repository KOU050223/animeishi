/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */
import { useState } from "react";
import { Button, View } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { useTierUrlShare } from "./urlShare.web";

const mockCopy = jest.fn();
// jest のモジュール解決は .web を選ばないため "./sheet" はフォールバック
// （throw スタブ）になる。web 実装の copyTierListUrl を差し込む。
jest.mock("./sheet", () => ({
  copyTierListUrl: (url: string) => mockCopy(url),
}));

const mockCanShare = jest.fn();
const mockShareFile = jest.fn();
const mockDownload = jest.fn();
// 同様に "./image" もフォールバック解決になるためモックする。
jest.mock("./image", () => ({
  canShareImageFile: (file: File) => mockCanShare(file),
  shareImageFile: (file: File, title: string) => mockShareFile(file, title),
  downloadImageFile: (file: File) => mockDownload(file),
}));

// Web 共有モーダル: URL 発行後にモーダルを出し、[Xで共有] / [URLをコピー] を
// ユーザーの操作内で実行する（ネットワーク待ち後の navigator.share は
// ブラウザのユーザー操作期限で拒否されるため）。
// 画像は「生成」→ 完了後の別ボタンで「共有 / ダウンロード」の 2 段階
// （生成待ちで操作期限が切れないようにするため）。

const SHARE_URL = "https://api.example/share/tier-lists/tok1";

const mockGenerateFile = jest.fn();

function Harness() {
  const { shareUrl, urlShareElement } = useTierUrlShare({
    tweetText: "テストTier表",
    generateImageFile: () => mockGenerateFile(),
  });
  const [result, setResult] = useState("");
  return (
    <View>
      <Button
        title="share"
        testID="share"
        onPress={() => void shareUrl(SHARE_URL).then(setResult)}
      />
      <Button title="result" testID="result" />
      {result !== "" && <View testID={`result-${result}`} />}
      {urlShareElement}
    </View>
  );
}

function pngFile(name = "テストTier表.png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

describe("useTierUrlShare (web)", () => {
  const openSpy = jest.fn();

  beforeEach(async () => {
    openSpy.mockReset();
    mockGenerateFile.mockReset();
    mockCanShare.mockReset().mockReturnValue(true);
    mockShareFile.mockReset().mockResolvedValue(undefined);
    mockDownload.mockReset();
    mockCopy.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, "open", { value: openSpy, writable: true });
  });

  it("shareUrl は 'shared' を返し、URL 入りのモーダルを開く", async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("share"));

    expect(await screen.findByTestId("result-shared")).toBeTruthy();
    expect(screen.getByText(SHARE_URL)).toBeTruthy();
  });

  it("「Xで共有」は intent/tweet を新規タブで開き URL と投稿文を載せる", async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("share"));
    await fireEvent.press(await screen.findByText("Xで共有"));

    expect(openSpy).toHaveBeenCalledWith(
      expect.stringContaining("https://twitter.com/intent/tweet?"),
      "_blank",
      expect.any(String),
    );
    const opened = new URL(openSpy.mock.calls[0][0] as string);
    expect(opened.searchParams.get("url")).toBe(SHARE_URL);
    expect(opened.searchParams.get("text")).toBe("テストTier表");
  });

  it("「URLをコピー」はクリップボードに書き込み、コピー済み表示になる", async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("share"));
    await fireEvent.press(await screen.findByText("URLをコピー"));

    expect(mockCopy).toHaveBeenCalledWith(SHARE_URL);
    expect(await screen.findByText("コピーしました")).toBeTruthy();
  });

  it("「閉じる」でモーダルを閉じる", async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("share"));
    await fireEvent.press(await screen.findByText("閉じる"));

    expect(screen.queryByText(SHARE_URL)).toBeNull();
  });

  it("「画像を生成」で File を作り、完了後の「画像を共有」で共有シートへ渡す", async () => {
    const file = pngFile();
    mockGenerateFile.mockResolvedValue(file);
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("share"));

    // 生成は非同期。act 内で押下し、File が確定するまで flush する
    await act(async () => {
      await fireEvent.press(await screen.findByText("画像を生成"));
    });

    // 生成完了後に共有ボタンが出る（生成待ちで操作期限を切らさない）。
    // 共有も非同期のため act 内で押して resolve → onClose まで flush する
    await act(async () => {
      await fireEvent.press(await screen.findByText("画像を共有"));
    });
    expect(mockShareFile).toHaveBeenCalledWith(file, "テストTier表");
    // 共有に渡せたらモーダルは閉じる
    await waitFor(() => expect(screen.queryByText(SHARE_URL)).toBeNull(), {
      timeout: 5000,
    });
  });

  it("共有非対応の環境では「画像をダウンロード」だけを出す", async () => {
    mockCanShare.mockReturnValue(false);
    mockGenerateFile.mockResolvedValue(pngFile());
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("share"));
    await act(async () => {
      await fireEvent.press(await screen.findByText("画像を生成"));
    });

    await fireEvent.press(await screen.findByText("画像をダウンロード"));
    expect(screen.queryByText("画像を共有")).toBeNull();
    expect(mockDownload).toHaveBeenCalledWith(expect.any(File));
    // ダウンロード後もモーダルは開いたまま（URL コピー等を続けられる）
    expect(screen.getByText(SHARE_URL)).toBeTruthy();
  });

  it("画像生成に失敗したらエラーを表示し、モーダルは開いたまま", async () => {
    mockGenerateFile.mockRejectedValue(new Error("capture failed"));
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("share"));
    await act(async () => {
      await fireEvent.press(await screen.findByText("画像を生成"));
    });

    expect(await screen.findByText("画像の生成に失敗しました")).toBeTruthy();
    expect(screen.getByText(SHARE_URL)).toBeTruthy();
    expect(mockShareFile).not.toHaveBeenCalled();
  });

  it("共有が失敗したらエラーを表示し、モーダルは開いたまま", async () => {
    mockGenerateFile.mockResolvedValue(pngFile());
    mockShareFile.mockRejectedValue(new Error("share failed"));
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("share"));
    await act(async () => {
      await fireEvent.press(await screen.findByText("画像を生成"));
    });
    await act(async () => {
      await fireEvent.press(await screen.findByText("画像を共有"));
    });

    expect(
      await screen.findByText(
        "共有に失敗しました。ダウンロードをお試しください。",
      ),
    ).toBeTruthy();
    expect(screen.getByText(SHARE_URL)).toBeTruthy();
  });
});
