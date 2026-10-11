/**
 * @jest-environment jsdom
 */
import { useState } from "react";
import { Button, View } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useTierUrlShare } from "./urlShare.web";

const mockCopy = jest.fn();
// jest のモジュール解決は .web を選ばないため "./sheet" はフォールバック
// （throw スタブ）になる。web 実装の copyTierListUrl を差し込む。
jest.mock("./sheet", () => ({
  copyTierListUrl: (url: string) => mockCopy(url),
}));

// Web 共有モーダル: URL 発行後にモーダルを出し、[Xで共有] / [URLをコピー] を
// ユーザーの操作内で実行する（ネットワーク待ち後の navigator.share は
// ブラウザのユーザー操作期限で拒否されるため）。

const SHARE_URL = "https://api.example/share/tier-lists/tok1";

function Harness() {
  const { shareUrl, urlShareElement } = useTierUrlShare({
    tweetText: "テストTier表",
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

describe("useTierUrlShare (web)", () => {
  const openSpy = jest.fn();

  beforeEach(() => {
    openSpy.mockReset();
    mockCopy.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(window, "open", { value: openSpy, writable: true });
  });

  it("shareUrl は 'shared' を返し、URL 入りのモーダルを開く", async () => {
    render(<Harness />);
    fireEvent.press(screen.getByTestId("share"));

    expect(await screen.findByTestId("result-shared")).toBeTruthy();
    expect(screen.getByText(SHARE_URL)).toBeTruthy();
  });

  it("「Xで共有」は intent/tweet を新規タブで開き URL と投稿文を載せる", async () => {
    render(<Harness />);
    fireEvent.press(screen.getByTestId("share"));
    fireEvent.press(await screen.findByText("Xで共有"));

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
    render(<Harness />);
    fireEvent.press(screen.getByTestId("share"));
    fireEvent.press(await screen.findByText("URLをコピー"));

    expect(mockCopy).toHaveBeenCalledWith(SHARE_URL);
    expect(await screen.findByText("コピーしました")).toBeTruthy();
  });

  it("「閉じる」でモーダルを閉じる", async () => {
    render(<Harness />);
    fireEvent.press(screen.getByTestId("share"));
    fireEvent.press(await screen.findByText("閉じる"));

    expect(screen.queryByText(SHARE_URL)).toBeNull();
  });
});
