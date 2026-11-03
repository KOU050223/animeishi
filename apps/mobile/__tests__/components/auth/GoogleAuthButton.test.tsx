import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { onboardingPending } from "@/lib/onboarding";
import { resetAuth, getAuthMock } from "@/test-utils/auth";
import type { GoogleAuthResult } from "@/lib/googleAuth";

// issue #412: ネイティブ Google 新規登録のオンボーディング振り分け。
// AuthGuard が isSignedIn を見て先にホームへ飛ばさないよう、
// onboardingPending は setActive より前に立てる必要がある（PR #457 指摘）。

const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockStartGoogleAuth = jest.fn<Promise<GoogleAuthResult>, []>();
jest.mock("@/lib/googleAuth", () => ({
  useGoogleAuth: () => ({ startGoogleAuth: mockStartGoogleAuth }),
}));

const onError = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  onboardingPending.current = false;
});

describe("GoogleAuthButton", () => {
  it("新規ユーザーの Google 登録は setActive より前に pending を立ててオンボーディングへ", async () => {
    const auth = getAuthMock();
    mockStartGoogleAuth.mockResolvedValue({
      status: "session-created",
      sessionId: "session_google_new",
      isNewUser: true,
    });

    // setActive 実行時点で pending が既に立っていることを検証する
    let pendingAtSetActive: boolean | null = null;
    auth.setActive.mockImplementation(async () => {
      pendingAtSetActive = onboardingPending.current;
    });

    await render(<GoogleAuthButton onError={onError} />);
    await fireEvent.press(screen.getByTestId("google-sign-in-button"));

    await waitFor(() => {
      expect(auth.setActive).toHaveBeenCalledWith({
        session: "session_google_new",
      });
      expect(mockReplace).toHaveBeenCalledWith("/onboarding");
    });
    expect(pendingAtSetActive).toBe(true);
    expect(onboardingPending.current).toBe(true);
  });

  it("setActive が失敗した新規登録は pending を戻してエラーを表示する", async () => {
    const auth = getAuthMock();
    mockStartGoogleAuth.mockResolvedValue({
      status: "session-created",
      sessionId: "session_google_new",
      isNewUser: true,
    });
    auth.setActive.mockRejectedValueOnce(new Error("setActive failed"));

    await render(<GoogleAuthButton onError={onError} />);
    await fireEvent.press(screen.getByTestId("google-sign-in-button"));

    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        "Google でのサインインに失敗しました",
      );
    });
    expect(onboardingPending.current).toBe(false);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("既存ユーザーの Google サインインは pending を立てずホームへ", async () => {
    const auth = getAuthMock();
    mockStartGoogleAuth.mockResolvedValue({
      status: "session-created",
      sessionId: "session_google_existing",
      isNewUser: false,
    });

    await render(<GoogleAuthButton onError={onError} />);
    await fireEvent.press(screen.getByTestId("google-sign-in-button"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(auth.setActive).toHaveBeenCalledWith({
      session: "session_google_existing",
    });
    expect(onboardingPending.current).toBe(false);
  });
});
