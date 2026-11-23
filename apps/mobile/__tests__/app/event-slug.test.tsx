// イベント詳細（/event/[slug]）のテスト（issue #610）。
// 「参加しているフレンド」と「参加者」の説明文、および「参加する」
// 前の公開範囲の注記が出ることを確かめる。
import React from "react";
import { render, screen } from "@testing-library/react-native";
import EventScreen from "@/app/event/[slug]";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import {
  useEvent,
  useEventParticipants,
  useEventParticipatingFriends,
  useExchangedEventFriends,
  useSetEventParticipation,
  useUpdateEventParticipationVisibility,
} from "@/lib/useEvents";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  // Stack.Screen の options を描画する。画面が headerLeft / title として
  // 渡したものをテストできるようにする。
  Stack: {
    Screen: ({ options }: any) => {
      const { Text } = require("react-native");
      return (
        <>
          {options?.headerLeft ? options.headerLeft({}) : null}
          {options?.title ? <Text>{options.title}</Text> : null}
        </>
      );
    },
  },
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => ({ slug: "test-event" }),
}));

// 本文の Markdown 描画はこのテストの対象外。
jest.mock("react-native-marked", () => ({ useMarkdown: () => [] }));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn(), confirm: jest.fn() }));

jest.mock("@/components/anime-list/WorkImage", () => ({
  WorkImage: () => null,
}));

// MenuPicker は @expo/ui のネイティブ Picker を使うため、jest では
// 置き物に差し替える（公開範囲ピッカーの存在は testID で検証する）。
jest.mock("@/components/ui/menu-picker", () => {
  const ActualReact = require("react");
  const { View } = require("react-native");
  return {
    MenuPicker: (props: { testID?: string }) =>
      ActualReact.createElement(View, { testID: props.testID }),
  };
});

jest.mock("@/lib/useEvents", () => ({
  useEvent: jest.fn(),
  useEventParticipants: jest.fn(),
  useEventParticipatingFriends: jest.fn(),
  useExchangedEventFriends: jest.fn(),
  useSetEventParticipation: jest.fn(),
  useUpdateEventParticipationVisibility: jest.fn(),
}));

const mockUseEvent = jest.mocked(useEvent);
const mockUseEventParticipants = jest.mocked(useEventParticipants);
const mockUseEventParticipatingFriends = jest.mocked(
  useEventParticipatingFriends,
);
const mockUseExchangedEventFriends = jest.mocked(useExchangedEventFriends);
const mockUseSetEventParticipation = jest.mocked(useSetEventParticipation);
const mockUseUpdateVisibility = jest.mocked(
  useUpdateEventParticipationVisibility,
);

const EVENT = {
  slug: "test-event",
  title: "テストイベント",
  body: null,
  coverImageUrl: null,
  location: null,
  officialUrl: null,
  // 常に会期中になるよう、実行時刻基準で生成する。
  startsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  endsAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  participating: false,
  participationVisibility: null,
};

// useInfiniteQuery 相当の戻り値。どちらの欄も同じエンドポイントの
// 応答（participants / friends の両方を含む）を参照する。
const attendeesQuery = () =>
  ({
    data: {
      pages: [
        { participants: [], participantTotal: 0, friends: [], friendsTotal: 0 },
      ],
      pageParams: [0],
    },
    isError: false,
    isLoading: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: jest.fn(),
  }) as unknown as ReturnType<typeof useEventParticipants>;

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  loggedInUser();
  mockUseEvent.mockReturnValue({
    data: EVENT,
    isLoading: false,
    isError: false,
  } as unknown as ReturnType<typeof useEvent>);
  mockUseEventParticipants.mockReturnValue(attendeesQuery());
  mockUseEventParticipatingFriends.mockReturnValue(attendeesQuery());
  mockUseExchangedEventFriends.mockReturnValue({
    data: { items: [] },
    isError: false,
    isLoading: false,
  } as unknown as ReturnType<typeof useExchangedEventFriends>);
  mockUseSetEventParticipation.mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useSetEventParticipation>);
  mockUseUpdateVisibility.mockReturnValue({
    mutate: jest.fn(),
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateEventParticipationVisibility>);
});

describe("イベント詳細の参加まわり（issue #610）", () => {
  it("未参加では「参加する」の前に公開範囲の注記を出す", async () => {
    await render(<EventScreen />);

    expect(
      screen.getByTestId("event-participate-visibility-note"),
    ).toHaveTextContent(
      "参加表明は既定で「非公開」です。公開範囲は参加後に変更できます",
    );
    expect(screen.getByTestId("event-participate")).toBeTruthy();
  });

  it("「参加しているフレンド」と「参加者」のそれぞれに説明文を出す", async () => {
    await render(<EventScreen />);

    expect(
      screen.getByText(
        "フレンドのうち、参加を「公開」または「フレンドのみ」にしている人（プロフィール非公開の人は除く）",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "フレンドかどうかに関わらず、参加を「公開」にしている人（プロフィール非公開の人は除く）",
      ),
    ).toBeTruthy();
    expect(screen.getByText("参加しているフレンド（0）")).toBeTruthy();
    expect(screen.getByText("参加者（0）")).toBeTruthy();
  });

  it("参加表明中は注記の代わりに公開範囲ピッカーを出す", async () => {
    mockUseEvent.mockReturnValue({
      data: {
        ...EVENT,
        participating: true,
        participationVisibility: "private",
      },
      isLoading: false,
      isError: false,
    } as unknown as ReturnType<typeof useEvent>);

    await render(<EventScreen />);

    expect(
      screen.queryByTestId("event-participate-visibility-note"),
    ).toBeNull();
    expect(screen.getByTestId("event-visibility")).toBeTruthy();
    expect(screen.getByTestId("event-participating-badge")).toBeTruthy();
  });
});
