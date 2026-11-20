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
import { useFavorites } from "@/lib/useFavorites";
import { useCommonPoints } from "@/lib/useCommonPoints";
import { useFriends } from "@/lib/useFriends";
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

// 成立カードは相手の公開プロフィールだけで組む。閲覧者自身の
// favorites / watch history を参照しないことをモックでガードする。
jest.mock("@/lib/useFavorites", () => ({
  useFavorites: jest.fn(() => ({ data: undefined })),
}));
jest.mock("@/lib/useCommonPoints", () => ({ useCommonPoints: jest.fn() }));
jest.mock("@/lib/useFriends", () => ({ useFriends: jest.fn() }));

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
  jest
    .mocked(useFriends)
    .mockReturnValue({ data: [] } as unknown as ReturnType<typeof useFriends>);
  jest.mocked(useCommonPoints).mockReturnValue({
    data: {
      watchingTogether: [
        { annictWorkId: 1, title: "共通のアニメ", hostedImageUrl: null },
      ],
      watchedTogetherCount: 0,
      favoriteTogether: [],
      conversationStarters: [],
    },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useCommonPoints>);
});

describe("ExchangeSuccessOverlay", () => {
  it("成立すると「名刺交換成立」と相手のユーザー名・自己紹介を出し、成功ハプティクスを鳴らす", async () => {
    loggedInUser({ userId: "user_me" });
    await render(
      <ExchangeSuccessOverlay uid="user_partner" onClose={mockOnClose} />,
      { wrapper },
    );

    expect(screen.getByText("名刺交換成立")).toBeTruthy();
    expect(haptics.success).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getByText("交換相手")).toBeTruthy();
      expect(screen.getByText("よろしく")).toBeTruthy();
      expect(screen.getByText("共通のアニメ")).toBeTruthy();
    });
    // 相手のカードに閲覧者自身の favorites / watch history が混入しない。
    expect(useFavorites).not.toHaveBeenCalled();
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

  it("相手が非公開でも交換済みフレンドの名刺情報と共通点を表示する", async () => {
    loggedInUser({ userId: "user_me" });
    mockProfileFetch({}, 404);
    jest.mocked(useFriends).mockReturnValue({
      data: [
        {
          friendId: "user_partner",
          username: "非公開の相手",
          bio: "交換済み",
          profileImageUrl: null,
        },
      ],
    } as unknown as ReturnType<typeof useFriends>);
    await render(
      <ExchangeSuccessOverlay uid="user_partner" onClose={mockOnClose} />,
      { wrapper },
    );
    expect(screen.getByText("非公開の相手")).toBeTruthy();
    expect(screen.getByText("共通のアニメ")).toBeTruthy();
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

  it("meetingCount を渡すと「◯回目の出会い」を出す（issue #662）", async () => {
    loggedInUser({ userId: "user_me" });
    await render(
      <ExchangeSuccessOverlay
        uid="user_partner"
        onClose={mockOnClose}
        meetingCount={3}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("exchange-success-count")).toBeTruthy();
    expect(screen.getByText("3回目の出会い")).toBeTruthy();
  });

  it("meetingCount を渡さないときは回数を出さない", async () => {
    loggedInUser({ userId: "user_me" });
    await render(
      <ExchangeSuccessOverlay uid="user_partner" onClose={mockOnClose} />,
      { wrapper },
    );

    expect(screen.queryByTestId("exchange-success-count")).toBeNull();
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

  it("onShowMyQr を渡すと「自分の QR も見せる」を出し、押すと呼ばれる（issue #682）", async () => {
    const onShowMyQr = jest.fn();
    loggedInUser({ userId: "user_me" });
    await render(
      <ExchangeSuccessOverlay
        uid="user_partner"
        onClose={mockOnClose}
        onShowMyQr={onShowMyQr}
      />,
      { wrapper },
    );

    await fireEvent.press(screen.getByTestId("exchange-success-show-my-qr"));

    // 遷移先の制御は呼び出し側なので、オーバーレイ自身は閉じず遷移もしない。
    expect(onShowMyQr).toHaveBeenCalledTimes(1);
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("onShowMyQr を渡さないとき「自分の QR も見せる」は出さない", async () => {
    loggedInUser({ userId: "user_me" });
    await render(
      <ExchangeSuccessOverlay uid="user_partner" onClose={mockOnClose} />,
      { wrapper },
    );

    expect(screen.queryByTestId("exchange-success-show-my-qr")).toBeNull();
  });
});
