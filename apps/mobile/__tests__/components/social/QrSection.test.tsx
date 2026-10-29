import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { QrSection } from "@/components/social/QrSection";
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
});

describe("スキャン", () => {
  it("スキャンタブに切り替えられる", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />);

    await fireEvent.press(screen.getByLabelText("スキャン"));

    expect(screen.getByText("QR コードを枠内に収めてください")).toBeTruthy();
  });
});
