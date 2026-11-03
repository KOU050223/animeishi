import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import MeishiViewerScreen from "@/app/meishi/[id]";
import type { MeishiCardData } from "@/lib/meishi/types";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockId: string | undefined = "card_a";

jest.mock("expo-router", () => ({
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
  useLocalSearchParams: () => ({ id: mockId }),
  useRouter: () => ({
    canGoBack: () => mockCanGoBack,
    back: mockBack,
    replace: mockReplace,
    push: mockPush,
  }),
}));

jest.mock("@/components/MeishiCard", () => ({
  MeishiCard: () => {
    const { Text } = require("react-native");
    return <Text>名刺本体</Text>;
  },
}));

jest.mock("@/lib/useProfile", () => ({
  useProfile: () => ({
    data: {
      id: "user_1",
      username: "テストユーザー",
      bio: "",
      favoriteQuote: "",
      profileImageUrl: null,
    },
  }),
}));

jest.mock("@/lib/useFavorites", () => ({
  useFavorites: () => ({ data: [] }),
}));

jest.mock("@/lib/useWatchHistory", () => ({
  useWatchHistory: () => ({ data: [] }),
}));

jest.mock("@/lib/profileUrl", () => ({
  buildProfileUrl: (userId: string | null | undefined) =>
    userId ? `http://localhost:8081/user/${userId}` : null,
}));

const makeCard = (id: string, name: string): MeishiCardData => ({
  id,
  name,
  createdAt: 1,
  updatedAt: 1,
  document: {
    version: 1,
    canvas: {
      aspectRatio: 1.6,
      background: { kind: "solid", color: "#ffffff" },
    },
    elements: [],
  },
});

let mockCards: MeishiCardData[] = [
  makeCard("card_a", "名刺A"),
  makeCard("card_b", "名刺B"),
];
let mockLoaded = true;

jest.mock("@/lib/meishi/useMeishiLibrary", () => ({
  useMeishiLibrary: () => ({
    cards: mockCards,
    defaultCard: mockCards[0] ?? null,
    loaded: mockLoaded,
    addCard: jest.fn(),
    duplicateCard: jest.fn(),
    removeCard: jest.fn(),
    setDefault: jest.fn(),
    reload: jest.fn(),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCards = [makeCard("card_a", "名刺A"), makeCard("card_b", "名刺B")];
  mockLoaded = true;
  mockCanGoBack = true;
  mockId = "card_a";
});

describe("名刺の全画面表示", () => {
  it("指定 id のカードを表示する", async () => {
    mockId = "card_b";
    await render(<MeishiViewerScreen />);

    expect(screen.getByText("名刺本体")).toBeTruthy();
    expect(screen.getByText("名刺B")).toBeTruthy();
  });

  it("編集ボタンでそのカードのエディタへ遷移する", async () => {
    mockId = "card_b";
    await render(<MeishiViewerScreen />);

    await fireEvent.press(screen.getByLabelText("名刺を編集"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/meishi/edit",
      params: { id: "card_b" },
    });
  });

  it("存在しない id のときは見つからない旨を表示する", async () => {
    mockId = "missing";
    await render(<MeishiViewerScreen />);

    expect(screen.getByText("この名刺は見つかりませんでした")).toBeTruthy();
    expect(screen.queryByText("名刺本体")).toBeNull();
  });

  it("読み込み中は本文を出さない", async () => {
    mockLoaded = false;
    await render(<MeishiViewerScreen />);

    expect(screen.queryByText("名刺本体")).toBeNull();
    expect(screen.queryByText("この名刺は見つかりませんでした")).toBeNull();
  });
});
