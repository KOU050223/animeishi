import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";

import IncomingShareScreen from "@/app/incoming-share";
import { scanQrFromImage } from "@/lib/incomingShare";

const CLERK_ID = "user_2abcDEF1234567890ghijKLMN";
const WEB_CARD_URL = `https://animeishi.uomi.dev/user/${CLERK_ID}`;

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockClear = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({
    canGoBack: () => true,
    back: mockBack,
    replace: mockReplace,
    push: jest.fn(),
  }),
}));

let mockShare: {
  sharedPayloads: { shareType: string; value: string }[];
  resolvedSharedPayloads: { contentType: string; contentUri?: string }[];
  isResolving: boolean;
  error: Error | null;
  clearSharedPayloads: jest.Mock;
};

jest.mock("expo-sharing", () => ({
  useIncomingShare: () => mockShare,
}));

jest.mock("@/lib/incomingShare", () => ({
  scanQrFromImage: jest.fn(),
}));

const mockScan = scanQrFromImage as jest.MockedFunction<typeof scanQrFromImage>;

function resetMockShare() {
  mockShare = {
    sharedPayloads: [],
    resolvedSharedPayloads: [],
    isResolving: false,
    error: null,
    clearSharedPayloads: mockClear,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetMockShare();
});

describe("IncomingShareScreen", () => {
  it("名刺 URL のテキスト共有は user/[uid] へ遷移する", async () => {
    mockShare.sharedPayloads = [{ shareType: "text", value: WEB_CARD_URL }];
    await render(<IncomingShareScreen />);

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: "/user/[uid]",
        params: { uid: CLERK_ID },
      }),
    );
  });

  it("Animeishi 以外の URL 共有はエラー表示で終える", async () => {
    mockShare.sharedPayloads = [
      { shareType: "url", value: "https://example.com/user/abc" },
    ];
    await render(<IncomingShareScreen />);

    expect(await screen.findByText("名刺を開けませんでした")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("isResolving 中は QR スキャンを開始せず、解決後の contentUri でスキャンする", async () => {
    mockScan.mockResolvedValue([WEB_CARD_URL]);
    mockShare.sharedPayloads = [
      { shareType: "image", value: "file:///raw-share.png" },
    ];
    mockShare.isResolving = true;
    const { rerender } = await render(<IncomingShareScreen />);

    expect(mockScan).not.toHaveBeenCalled();

    mockShare.isResolving = false;
    mockShare.resolvedSharedPayloads = [
      { contentType: "image", contentUri: "file:///resolved.png" },
    ];
    await rerender(<IncomingShareScreen />);

    await waitFor(() =>
      expect(mockScan).toHaveBeenCalledWith("file:///resolved.png"),
    );
    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: "/user/[uid]",
        params: { uid: CLERK_ID },
      }),
    );
  });

  it("解決後も contentUri が無ければ生の value にフォールバックする", async () => {
    mockScan.mockResolvedValue([WEB_CARD_URL]);
    mockShare.sharedPayloads = [
      { shareType: "image", value: "file:///raw-share.png" },
    ];
    mockShare.isResolving = false;
    await render(<IncomingShareScreen />);

    await waitFor(() =>
      expect(mockScan).toHaveBeenCalledWith("file:///raw-share.png"),
    );
  });

  it("名刺でない QR 画像はエラー表示し、次の共有でエラーが解除される", async () => {
    mockScan.mockResolvedValue(["https://example.com/not-a-card"]);
    mockShare.sharedPayloads = [
      { shareType: "image", value: "file:///qr.png" },
    ];
    const { rerender } = await render(<IncomingShareScreen />);

    expect(await screen.findByText("名刺を開けませんでした")).toBeTruthy();

    // 同じ画面に別の共有（名刺 URL テキスト）が届く
    mockShare.sharedPayloads = [{ shareType: "text", value: WEB_CARD_URL }];
    await rerender(<IncomingShareScreen />);

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith({
        pathname: "/user/[uid]",
        params: { uid: CLERK_ID },
      }),
    );
    expect(screen.queryByText("名刺を開けませんでした")).toBeNull();
  });

  it("スキャン中に別の共有が届いたら、遅れて届いた結果で状態を更新しない", async () => {
    let resolveScan: (codes: string[]) => void = () => {};
    mockScan.mockImplementation(
      () => new Promise<string[]>((resolve) => (resolveScan = resolve)),
    );
    mockShare.sharedPayloads = [
      { shareType: "image", value: "file:///qr-a.png" },
    ];
    const { rerender } = await render(<IncomingShareScreen />);

    await waitFor(() =>
      expect(mockScan).toHaveBeenCalledWith("file:///qr-a.png"),
    );

    // スキャン未完了のまま別の共有（名刺 URL テキスト）に切り替わる
    mockShare.sharedPayloads = [{ shareType: "text", value: WEB_CARD_URL }];
    await rerender(<IncomingShareScreen />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalled());

    // 遅れて旧スキャンが別ユーザーの名刺を返しても遷移・失敗表示しない
    resolveScan(["https://animeishi.uomi.dev/user_user_stale000000000"]);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledTimes(1));
    expect(mockReplace).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: CLERK_ID },
    });
    expect(screen.queryByText("名刺を開けませんでした")).toBeNull();
  });
});
