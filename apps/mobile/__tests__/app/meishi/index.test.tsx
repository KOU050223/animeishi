import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import MeishiDeckScreen from "@/app/meishi/index";
import type { MeishiCardData } from "@/lib/meishi/types";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
const mockDuplicateCard = jest.fn();
const mockRemoveCard = jest.fn();
const mockSetDefault = jest.fn();
const mockConfirm = jest.fn(
  (
    _title: string,
    _message: string,
    onConfirm: () => void,
    _options?: unknown,
  ) => onConfirm(),
);

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
  useRouter: () => ({
    canGoBack: () => mockCanGoBack,
    back: mockBack,
    replace: mockReplace,
    push: mockPush,
  }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(effect, [effect]);
  },
}));

jest.mock("@/components/MeishiCard", () => ({
  MeishiCard: () => {
    const { Text } = require("react-native");
    return <Text>名刺サムネイル</Text>;
  },
}));

jest.mock("@/components/ui/bottom-sheet", () => ({
  BottomSheet: ({ visible, children }: any) => (visible ? children : null),
}));

jest.mock("@/lib/dialog", () => ({
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: unknown,
  ) => mockConfirm(title, message, onConfirm, options),
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

const cards = [makeCard("card_a", "名刺A"), makeCard("card_b", "名刺B")];

let mockCards: MeishiCardData[] = cards;
let mockDefaultCard: MeishiCardData | null = cards[0];
let mockLoaded = true;

jest.mock("@/lib/meishi/useMeishiLibrary", () => ({
  useMeishiLibrary: () => ({
    cards: mockCards,
    defaultCard: mockDefaultCard,
    loaded: mockLoaded,
    addCard: jest.fn(),
    duplicateCard: mockDuplicateCard,
    removeCard: mockRemoveCard,
    setDefault: mockSetDefault,
    reload: jest.fn(),
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCards = cards;
  mockDefaultCard = cards[0];
  mockLoaded = true;
  mockCanGoBack = true;
});

describe("名刺一覧画面", () => {
  it("カード名と既定バッジを表示する", async () => {
    await render(<MeishiDeckScreen />);

    expect(screen.getByText("名刺A")).toBeTruthy();
    expect(screen.getByText("名刺B")).toBeTruthy();
    // 既定バッジは既定のカードだけに付く
    expect(screen.getAllByText("既定")).toHaveLength(1);
  });

  it("カードをタップすると全画面表示へ遷移する", async () => {
    await render(<MeishiDeckScreen />);

    await fireEvent.press(screen.getByLabelText("名刺Bを開く"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/meishi/[id]",
      params: { id: "card_b" },
    });
  });

  it("新規作成タイルからエディタへ新規モードで遷移する", async () => {
    await render(<MeishiDeckScreen />);

    await fireEvent.press(screen.getByLabelText("新しい名刺を作る"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/meishi/edit",
      params: { create: "1" },
    });
  });

  it("メニューから複製できる", async () => {
    await render(<MeishiDeckScreen />);

    await fireEvent.press(screen.getByLabelText("名刺Aのメニュー"));
    await fireEvent.press(screen.getByText("複製する"));

    expect(mockDuplicateCard).toHaveBeenCalledWith("card_a");
  });

  it("メニューから既定カードを切り替えられる", async () => {
    await render(<MeishiDeckScreen />);

    await fireEvent.press(screen.getByLabelText("名刺Bのメニュー"));
    await fireEvent.press(screen.getByText("既定にする"));

    expect(mockSetDefault).toHaveBeenCalledWith("card_b");
  });

  it("既定のカードには「既定にする」を出さない", async () => {
    await render(<MeishiDeckScreen />);

    await fireEvent.press(screen.getByLabelText("名刺Aのメニュー"));

    expect(screen.queryByText("既定にする")).toBeNull();
  });

  it("メニューから削除を確認して実行する", async () => {
    await render(<MeishiDeckScreen />);

    await fireEvent.press(screen.getByLabelText("名刺Aのメニュー"));
    await fireEvent.press(screen.getByText("削除する"));

    expect(mockConfirm).toHaveBeenCalled();
    expect(mockRemoveCard).toHaveBeenCalledWith("card_a");
  });

  it("メニューから全画面表示へ遷移する", async () => {
    await render(<MeishiDeckScreen />);

    await fireEvent.press(screen.getByLabelText("名刺Bのメニュー"));
    await fireEvent.press(screen.getByText("全画面で見る"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/meishi/[id]",
      params: { id: "card_b" },
    });
  });

  it("メニューからエディタへ遷移する", async () => {
    await render(<MeishiDeckScreen />);

    await fireEvent.press(screen.getByLabelText("名刺Aのメニュー"));
    await fireEvent.press(screen.getByText("編集する"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/meishi/edit",
      params: { id: "card_a" },
    });
  });

  it("カードが無いときは空状態と作成導線を出す", async () => {
    mockCards = [];
    mockDefaultCard = null;
    await render(<MeishiDeckScreen />);

    expect(screen.getByText("まだ名刺がありません")).toBeTruthy();

    await fireEvent.press(screen.getByLabelText("新しい名刺を作る"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/meishi/edit",
      params: { create: "1" },
    });
  });

  it("戻り先がある場合は履歴を戻る", async () => {
    await render(<MeishiDeckScreen />);

    await fireEvent.press(screen.getByLabelText("戻る"));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
