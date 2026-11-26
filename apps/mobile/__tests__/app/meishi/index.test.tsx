import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import MeishiDeckScreen from "@/app/meishi/index";
import type { MeishiCardData } from "@/features/meishi/types";
import { loadMeishiLibrary } from "@/features/meishi/storage";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
const mockDuplicateCard = jest.fn();
const mockRemoveCard = jest.fn();
const mockSetDefault = jest.fn();
const mockPublishSnapshot = jest.fn();
const mockLoadMeishiLibrary = jest.mocked(loadMeishiLibrary);
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
    const ActualReact = require("react");
    ActualReact.useEffect(effect, [effect]);
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

jest.mock("@/features/me/useProfile", () => ({
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
jest.mock("@/features/favorites/useFavorites", () => ({
  useFavorites: () => ({ data: [] }),
}));
jest.mock("@/features/watch-history/useWatchHistory", () => ({
  useWatchHistory: () => ({ data: [] }),
}));
jest.mock("@/features/achievements/useAchievements", () => ({
  useAchievements: () => ({ data: undefined }),
}));
jest.mock("@/features/meishi/publicSnapshot/usePublicMeishiSnapshot", () => ({
  usePublicMeishiSnapshot: () => ({
    publish: mockPublishSnapshot,
    clear: jest.fn(),
    snapshotElement: null,
  }),
}));
jest.mock("@/features/meishi/storage", () => ({
  loadMeishiLibrary: jest.fn(),
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
let mockDefaultCard: MeishiCardData | null = cards[0] ?? null;
let mockLoaded = true;

jest.mock("@/features/meishi/useMeishiLibrary", () => ({
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
  mockPublishSnapshot.mockResolvedValue(undefined);
  mockLoadMeishiLibrary.mockResolvedValue(null);
  mockSetDefault.mockResolvedValue(undefined);
  mockRemoveCard.mockResolvedValue(undefined);
  mockCards = cards;
  mockDefaultCard = cards[0] ?? null;
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
    expect(
      screen.getByText(
        "既定の名刺はプロフィールタブに表示されます。プロフィール用 QR は公開プロフィールを開き、画像共有は編集中の名刺を使います",
      ),
    ).toBeTruthy();
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
    await waitFor(() => expect(mockPublishSnapshot).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(mockRemoveCard).toHaveBeenCalledWith("card_a"));
  });

  it("削除前後に保存された既定が変われば新しい名刺を公開する", async () => {
    mockLoadMeishiLibrary
      .mockResolvedValueOnce({ version: 1, cards, defaultCardId: "card_b" })
      .mockResolvedValueOnce({
        version: 1,
        cards: cards.slice(0, 1),
        defaultCardId: "card_a",
      });
    await render(<MeishiDeckScreen />);
    await fireEvent.press(screen.getByLabelText("名刺Bのメニュー"));
    await fireEvent.press(screen.getByText("削除する"));
    await waitFor(() => expect(mockPublishSnapshot).toHaveBeenCalledTimes(1));
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
