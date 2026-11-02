import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExchangeSuccessOverlay } from "@/components/social/ExchangeSuccessOverlay";
import { haptics } from "@/lib/haptics";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

const PROFILE = {
  id: "user_partner",
  username: "交換相手",
  bio: "よろしく",
  favoriteQuote: null,
  profileImageUrl: null,
  genres: [],
};

const mockPush = jest.fn();
const mockOnClose = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// 成立時のハプティクス呼び出しを検証するため実装を差し替える。
jest.mock("@/lib/haptics", () => ({
  haptics: {
    success: jest.fn(),
    warning: jest.fn(),
    selection: jest.fn(),
    impactLight: jest.fn(),
  },
}));

// 名刺カードの描画自体は MeishiCard 側の責務。ここでは公開プロフィールが
// props として渡ることだけを見る。
jest.mock("@/components/MeishiCard", () => ({
  MeishiCard: (props: { username?: string | null }) => {
    const { Text } = require("react-native");
    return <Text testID="meishi-card">{props.username}</Text>;
  },
}));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function mockProfileFetch(body: unknown = PROFILE, status = 200) {
  global.fetch = jest.fn(async () => ({
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  mockProfileFetch();
});

describe("ExchangeSuccessOverlay", () => {
  it("成立すると「名刺交換成立」と相手の名刺カードを出し、成功ハプティクスを鳴らす", async () => {
    loggedInUser({ userId: "user_me" });
    await render(
      <ExchangeSuccessOverlay uid="user_partner" onClose={mockOnClose} />,
      { wrapper },
    );

    expect(screen.getByText("名刺交換成立")).toBeTruthy();
    expect(haptics.success).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("meishi-card")).toHaveTextContent("交換相手"),
    );
  });

  it("「プロフィールを見る」で相手の user/[uid] へ遷移し、オーバーレイを閉じる", async () => {
    loggedInUser({ userId: "user_me" });
    await render(
      <ExchangeSuccessOverlay uid="user_partner" onClose={mockOnClose} />,
      { wrapper },
    );

    await fireEvent.press(screen.getByTestId("exchange-success-profile-link"));

    expect(mockOnClose).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "user_partner" },
    });
  });

  it("showProfileLink=false のとき「プロフィールを見る」を出さない", async () => {
    loggedInUser({ userId: "user_me" });
    await render(
      <ExchangeSuccessOverlay
        uid="user_partner"
        onClose={mockOnClose}
        showProfileLink={false}
      />,
      { wrapper },
    );

    expect(screen.getByText("名刺交換成立")).toBeTruthy();
    expect(screen.queryByTestId("exchange-success-profile-link")).toBeNull();
  });

  it("「閉じる」で onClose が呼ばれる", async () => {
    loggedInUser({ userId: "user_me" });
    await render(
      <ExchangeSuccessOverlay uid="user_partner" onClose={mockOnClose} />,
      { wrapper },
    );

    await fireEvent.press(screen.getByTestId("exchange-success-close"));

    expect(mockOnClose).toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
