/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */
import type { RefObject } from "react";
import type { ViewInstance } from "react-native";
import { saveReceivedMeishi } from "./saveReceivedMeishi.web";

// ダウンロードへの受け渡しは tierList/share 側の責務なのでモックし、
// 渡した File の中身（名前・型）だけを見る。
const mockDownloadImageFile = jest.fn();
jest.mock("@/features/tier-lists/share/image", () => ({
  downloadImageFile: (file: File) => mockDownloadImageFile(file),
}));

const target = { current: null } as RefObject<ViewInstance | null>;

function mockFetch(blob: Blob, ok = true, status = 200) {
  global.fetch = jest.fn(async () => ({
    ok,
    status,
    blob: async () => blob,
  })) as unknown as typeof fetch;
}

describe("saveReceivedMeishi (web)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("画像 URL を fetch して元の PNG をそのままダウンロードする", async () => {
    mockFetch(new Blob(["png-bytes"], { type: "image/png" }));

    await saveReceivedMeishi({
      imageUrl: "https://api.example/snap.png?v=1",
      target,
      title: "対象ユーザーの名刺",
    });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.example/snap.png?v=1",
    );
    const file = mockDownloadImageFile.mock.calls[0][0] as File;
    expect(file.name).toBe("対象ユーザーの名刺.png");
    expect(file.type).toBe("image/png");
  });

  it("ファイル名に使えない文字は _ に置き換える", async () => {
    mockFetch(new Blob(["png-bytes"], { type: "image/png" }));

    await saveReceivedMeishi({
      imageUrl: "https://api.example/snap.png",
      target,
      title: 'a/b:c"d"',
    });

    const file = mockDownloadImageFile.mock.calls[0][0] as File;
    expect(file.name).toBe("a_b_c_d_.png");
  });

  it("画像の取得に失敗したら reject してダウンロードしない", async () => {
    mockFetch(new Blob(), false, 404);

    await expect(
      saveReceivedMeishi({
        imageUrl: "https://api.example/snap.png",
        target,
        title: "名刺",
      }),
    ).rejects.toThrow();
    expect(mockDownloadImageFile).not.toHaveBeenCalled();
  });
});
