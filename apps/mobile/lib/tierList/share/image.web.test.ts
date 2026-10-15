/**
 * @jest-environment jsdom
 */
import type { RefObject } from "react";
import type { View } from "react-native";
import {
  canShareImageFile,
  captureTierListImageFile,
  downloadImageFile,
  shareImageFile,
  shareTierListImage,
} from "./image.web";
import { apiUrl } from "@/lib/apiUrl";

// toPng 自体はブラウザ依存（canvas）なのでモックし、dataURL を返すだけにする。
const mockToPng = jest.fn();
jest.mock("html-to-image", () => ({
  toPng: (node: unknown, options: unknown) => mockToPng(node, options),
}));

const PNG_DATA_URL = "data:image/png;base64,ZmFrZS1wbmc=";

function buildTarget(html: string): RefObject<View | null> {
  const div = document.createElement("div");
  div.innerHTML = html;
  document.body.appendChild(div);
  return { current: div } as unknown as RefObject<View | null>;
}

/** 差し替え後の src の読み込みを全て完了させる（load か error を発火する）。 */
function fireImageEvents(root: HTMLElement, type: "load" | "error") {
  root
    .querySelectorAll("img")
    .forEach((img) => img.dispatchEvent(new Event(type)));
}

describe("shareTierListImage (web)", () => {
  const shareMock = jest.fn();
  const canShareMock = jest.fn();
  const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");

  beforeEach(() => {
    document.body.innerHTML = "";
    mockToPng.mockReset().mockResolvedValue(PNG_DATA_URL);
    shareMock.mockReset().mockResolvedValue(undefined);
    canShareMock.mockReset().mockReturnValue(true);
    clickSpy.mockReset();
    Object.defineProperty(navigator, "share", {
      value: shareMock,
      configurable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: canShareMock,
      configurable: true,
    });
    Object.defineProperty(URL, "createObjectURL", {
      value: jest.fn(() => "blob:mock"),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: jest.fn(),
      configurable: true,
    });
  });

  it("img の src を画像プロキシに差し替えてから PNG 化し、ファイル共有する", async () => {
    const target = buildTarget(
      '<img src="https://s4.anilist.co/a.png" /><img src="https://cdn.myanimelist.net/b.jpg" />',
    );
    const promise = shareTierListImage(target, { dialogTitle: "テスト表" });
    const node = target.current as unknown as HTMLElement;
    // src がプロキシ URL に差し替わったことを確認してから load を発火する
    node.querySelectorAll("img").forEach((img) => {
      expect(img.src).toContain("/share/image-proxy?url=");
    });
    expect(node.querySelector("img")!.src).toContain(
      encodeURIComponent("https://s4.anilist.co/a.png"),
    );
    fireImageEvents(node, "load");
    await promise;

    expect(mockToPng).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ pixelRatio: 2, skipFonts: true }),
    );
    expect(canShareMock).toHaveBeenCalledWith({
      files: [expect.any(File)],
    });
    const shared = shareMock.mock.calls[0][0] as {
      files: File[];
      title: string;
    };
    expect(shared.title).toBe("テスト表");
    expect(shared.files[0].name).toBe("テスト表.png");
    expect(shared.files[0].type).toBe("image/png");
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("canShare が無い環境ではダウンロードにフォールバックする", async () => {
    canShareMock.mockReturnValue(false);
    const target = buildTarget("<div>tier</div>");
    await shareTierListImage(target, { dialogTitle: "保存用" });
    expect(shareMock).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it("navigator.share が無い環境でもダウンロードする", async () => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    const target = buildTarget("<div>tier</div>");
    await shareTierListImage(target, { dialogTitle: "a/b.png" });
    expect(clickSpy).toHaveBeenCalled();
  });

  it("ファイル名に使えない文字は _ に置き換える", async () => {
    const target = buildTarget("<div>tier</div>");
    await shareTierListImage(target, { dialogTitle: 'a/b:c?"d"' });
    const file = (shareMock.mock.calls[0][0] as { files: File[] }).files[0];
    expect(file.name).toBe("a_b_c__d_.png");
  });

  it("プロキシ画像の読み込みに失敗した img は取り除く", async () => {
    const target = buildTarget(
      '<div><img src="https://example.com/ng.png" /><span>keep</span></div>',
    );
    const node = target.current as unknown as HTMLElement;
    const promise = shareTierListImage(target, { dialogTitle: "t" });
    fireImageEvents(node, "error");
    await promise;
    expect(node.querySelector("img")).toBeNull();
    expect(node.querySelector("span")).not.toBeNull();
    expect(mockToPng).toHaveBeenCalled();
  });

  it("data: URL の img はプロキシに差し替えない", async () => {
    const dataSrc = "data:image/gif;base64,R0lGODlh";
    const target = buildTarget(`<img src="${dataSrc}" />`);
    const node = target.current as unknown as HTMLElement;
    await shareTierListImage(target, { dialogTitle: "t" });
    expect(node.querySelector("img")!.src).toBe(dataSrc);
  });

  it("API 配信の取り込み済み画像（/images/...）はプロキシに差し替えない", async () => {
    // R2 自前配信 URL は CORS 付きなので html-to-image がそのまま fetch できる。
    // image-proxy に通すと known-URL 照合で 403 になるため差し替えない（issue #174）。
    const hostedSrc = `${apiUrl}/images/works/1/abc12345.png`;
    const target = buildTarget(`<img src="${hostedSrc}" />`);
    const node = target.current as unknown as HTMLElement;
    await shareTierListImage(target, { dialogTitle: "t" });
    expect(node.querySelector("img")!.src).toBe(hostedSrc);
  });

  it("共有シートをユーザーが閉じた（AbortError）場合は完了扱いにする", async () => {
    shareMock.mockRejectedValue(
      Object.assign(new Error("cancelled"), { name: "AbortError" }),
    );
    const target = buildTarget("<div>tier</div>");
    await expect(
      shareTierListImage(target, { dialogTitle: "t" }),
    ).resolves.toBeUndefined();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("共有が AbortError 以外で失敗したらダウンロードへフォールバックする", async () => {
    shareMock.mockRejectedValue(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    const target = buildTarget("<div>tier</div>");
    await shareTierListImage(target, { dialogTitle: "t" });
    expect(clickSpy).toHaveBeenCalled();
  });

  it("ref が DOM 要素でなければエラーになる", async () => {
    const target = { current: {} } as unknown as RefObject<View | null>;
    await expect(
      shareTierListImage(target, { dialogTitle: "t" }),
    ).rejects.toThrow("キャプチャ対象の DOM 要素が見つかりません");
  });
});

describe("captureTierListImageFile (web)", () => {
  const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");

  beforeEach(() => {
    document.body.innerHTML = "";
    mockToPng.mockReset().mockResolvedValue(PNG_DATA_URL);
    clickSpy.mockReset();
    Object.defineProperty(navigator, "share", {
      value: jest.fn(),
      configurable: true,
    });
  });

  it("PNG 化した File を返すだけで、共有・ダウンロードはしない", async () => {
    const target = buildTarget("<div>tier</div>");
    const file = await captureTierListImageFile(target, { title: "テスト表" });
    expect(file.name).toBe("テスト表.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBeGreaterThan(0);
    // 受け渡しは呼び出し側（モーダル内の別ボタン）が行う
    expect(navigator.share).not.toHaveBeenCalled();
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it("画像が 1 枚も無くても File を返す", async () => {
    const target = buildTarget("<span>only text</span>");
    const file = await captureTierListImageFile(target, { title: "t" });
    expect(file.type).toBe("image/png");
  });
});

describe("canShareImageFile / shareImageFile / downloadImageFile (web)", () => {
  const shareMock = jest.fn();
  const canShareMock = jest.fn();
  const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click");
  const FILE = () =>
    new File([new Uint8Array([1, 2, 3])], "tier.png", { type: "image/png" });

  beforeEach(() => {
    shareMock.mockReset().mockResolvedValue(undefined);
    canShareMock.mockReset().mockReturnValue(true);
    clickSpy.mockReset();
    Object.defineProperty(navigator, "share", {
      value: shareMock,
      configurable: true,
    });
    Object.defineProperty(navigator, "canShare", {
      value: canShareMock,
      configurable: true,
    });
    Object.defineProperty(URL, "createObjectURL", {
      value: jest.fn(() => "blob:mock"),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: jest.fn(),
      configurable: true,
    });
  });

  it("canShareImageFile は canShare({ files }) の結果を返す", () => {
    const file = FILE();
    expect(canShareImageFile(file)).toBe(true);
    expect(canShareMock).toHaveBeenCalledWith({ files: [file] });
    canShareMock.mockReturnValue(false);
    expect(canShareImageFile(file)).toBe(false);
  });

  it("canShare / share が無い環境では canShareImageFile は false", () => {
    Object.defineProperty(navigator, "canShare", {
      value: undefined,
      configurable: true,
    });
    expect(canShareImageFile(FILE())).toBe(false);
  });

  it("shareImageFile は生成済み File を share へ渡す", async () => {
    const file = FILE();
    await shareImageFile(file, "テスト表");
    expect(shareMock).toHaveBeenCalledWith({
      files: [file],
      title: "テスト表",
    });
  });

  it("shareImageFile: AbortError は完了扱い、それ以外は再 throw する", async () => {
    shareMock.mockRejectedValueOnce(
      Object.assign(new Error("cancelled"), { name: "AbortError" }),
    );
    await expect(shareImageFile(FILE(), "t")).resolves.toBeUndefined();

    shareMock.mockRejectedValueOnce(
      Object.assign(new Error("denied"), { name: "NotAllowedError" }),
    );
    await expect(shareImageFile(FILE(), "t")).rejects.toThrow("denied");
  });

  it("shareImageFile: navigator.share が無い環境ではエラーになる", async () => {
    Object.defineProperty(navigator, "share", {
      value: undefined,
      configurable: true,
    });
    await expect(shareImageFile(FILE(), "t")).rejects.toThrow(
      "Web Share API を利用できません",
    );
  });

  it("downloadImageFile は a.download 経由で保存する", () => {
    const file = FILE();
    downloadImageFile(file);
    expect(clickSpy).toHaveBeenCalled();
  });
});
