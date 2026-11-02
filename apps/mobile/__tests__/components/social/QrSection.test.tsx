import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import * as Clipboard from "expo-clipboard";
import { QrSection } from "@/components/social/QrSection";
import { alert } from "@/lib/dialog";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";

// react-native-qrcode-svg の描画結果ではなく、QR に埋め込む値を検証するため
// props を記録するスタブに差し替える。
const mockQRCodeProps = jest.fn();
jest.mock("react-native-qrcode-svg", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const MockQRCode = (props: { value: string; size?: number }) => {
    mockQRCodeProps(props);
    return React.createElement(Text, { testID: "qr-code" }, props.value);
  };
  return { __esModule: true, default: MockQRCode };
});

jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [
    { granted: true, canAskAgain: true, expires: "never", status: "granted" },
    jest.fn(),
  ],
}));

jest.mock("expo-router", () => ({
  useIsFocused: () => true,
}));

jest.mock("@/lib/useFriends", () => ({
  useAddFriend: () => ({ mutate: jest.fn(), isPending: false }),
}));

jest.mock("@/lib/dialog", () => ({
  alert: jest.fn(),
  confirm: jest.fn(),
}));

// 共有・画像保存の実体は lib 側で担保済み。ここでは呼び出しの結線だけを見る。
const mockShareTierListUrl = jest.fn();
jest.mock("@/lib/tierList/share", () => ({
  shareTierListUrl: (url: string) => mockShareTierListUrl(url),
}));

const mockSaveQrImage = jest.fn();
jest.mock("@/lib/qrImage", () => ({
  saveQrImage: (...args: unknown[]) => mockSaveQrImage(...args),
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => {}),
}));

// 本番相当の Web URL が埋め込まれることを固定値で表現する。
// buildProfileUrl 自体の解決（EXPO_PUBLIC_WEB_URL 等）は
// lib/profileUrl のテストで担保済み。
jest.mock("@/lib/profileUrl", () => ({
  buildProfileUrl: (userId: string | null | undefined) =>
    userId ? `https://animeishi.uomi.dev/user/${userId}` : null,
}));

const USER_ID = "user_2abcDEF1234567890ghijKLMN";

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
});

describe("マイQR（QR コード生成）", () => {
  it("OS 標準カメラでも開けるよう Web 版プロフィール URL を QR に埋め込む", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />);

    expect(mockQRCodeProps).toHaveBeenCalledWith(
      expect.objectContaining({
        value: `https://animeishi.uomi.dev/user/${USER_ID}`,
      }),
    );
  });

  it("生の userId ではなく /user/<id> 形式の URL になる", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />);

    const qr = screen.getByTestId("qr-code");
    expect(qr.props.children).toContain(`/user/${USER_ID}`);
    expect(qr.props.children).not.toBe(USER_ID);
  });

  it("未サインインなら QR を表示しない", async () => {
    signedOutUser();
    await render(<QrSection />);

    expect(mockQRCodeProps).not.toHaveBeenCalled();
    expect(
      screen.getByText("QR コードを表示するにはサインインしてください"),
    ).toBeTruthy();
  });

  it("リンクをコピーでプロフィール URL がクリップボードに入り「コピーしました」になる", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />);

    await fireEvent.press(screen.getByTestId("qr-copy-link"));

    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
        `https://animeishi.uomi.dev/user/${USER_ID}`,
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("コピーしました")).toBeTruthy(),
    );
  });

  it("リンクを共有で共有処理にプロフィール URL が渡される", async () => {
    mockShareTierListUrl.mockResolvedValue("shared");
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />);

    await fireEvent.press(screen.getByTestId("qr-share-link"));

    await waitFor(() =>
      expect(mockShareTierListUrl).toHaveBeenCalledWith(
        `https://animeishi.uomi.dev/user/${USER_ID}`,
      ),
    );
  });

  it("共有を自動で渡せなかった（blocked）ときは URL 入りのアラートを出す", async () => {
    mockShareTierListUrl.mockResolvedValue("blocked");
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />);

    await fireEvent.press(screen.getByTestId("qr-share-link"));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "共有できませんでした",
        `https://animeishi.uomi.dev/user/${USER_ID}`,
        { okLabel: "OK" },
      ),
    );
  });

  it("画像で保存で QR カードの画像化・保存が呼ばれる", async () => {
    mockSaveQrImage.mockResolvedValue(undefined);
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />);

    await fireEvent.press(screen.getByTestId("qr-save-image"));

    await waitFor(() =>
      expect(mockSaveQrImage).toHaveBeenCalledWith(
        expect.objectContaining({ current: expect.anything() }),
        expect.objectContaining({
          title: "マイ QR",
          backgroundColor: "#ffffff",
        }),
      ),
    );
  });
});

describe("スキャン", () => {
  it("スキャンタブに切り替えられる", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />);

    await fireEvent.press(screen.getByLabelText("スキャン"));

    expect(screen.getByText("QR コードを枠内に収めてください")).toBeTruthy();
  });
});
