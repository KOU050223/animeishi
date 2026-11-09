import React from "react";
import { StyleSheet } from "react-native";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  fireGestureHandler,
  getByGestureTestId,
} from "react-native-gesture-handler/jest-utils";
import MeishiEditScreen from "@/app/meishi/edit";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockDismissTo = jest.fn();
const mockCanGoBack = jest.fn();
const mockSaveDocument = jest.fn();
const mockShareMeishiImage = jest.fn();
let mockSearchParams: { id?: string; create?: string } = {};

jest.mock("expo-router", () => ({
  Stack: {
    Screen: () => null,
  },
  useLocalSearchParams: () => mockSearchParams,
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
    push: jest.fn(),
    dismissTo: mockDismissTo,
  }),
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

// jest 環境には RNGH のネイティブモジュールが無いため、公式モックに差し替える。
// GestureDetector を実際に描画して fireGestureHandler でタップを発火させる
// テスト（灰色領域タップでの選択解除、issue #494）に必要。
// jest では lib/module 側が解決されるが、ソース（Metro 側）経由の import も
// あるため公式 jestSetup と同様に両方をモックする。
jest.mock("react-native-gesture-handler/src/RNGestureHandlerModule", () =>
  require("react-native-gesture-handler/src/mocks/module"),
);
jest.mock(
  "react-native-gesture-handler/lib/module/RNGestureHandlerModule",
  () => require("react-native-gesture-handler/lib/module/mocks/module"),
);

jest.mock("@/components/meishi/EditorCanvas", () => ({
  EditorCanvas: ({ onSelect }: { onSelect: (id: string | null) => void }) => {
    const { Pressable, Text } = require("react-native");
    return (
      <Pressable
        accessibilityLabel="名刺の要素を選択"
        onPress={() => onSelect("el_1")}
      >
        <Text>名刺キャンバス</Text>
      </Pressable>
    );
  },
}));

jest.mock("@/components/meishi/AddElementSheet", () => ({
  AddElementSheet: () => null,
}));

jest.mock("@/components/meishi/AnimeImagePicker", () => ({
  AnimeImagePicker: () => null,
}));

jest.mock("@/lib/useMeishiAssetUpload", () => ({
  useMeishiAssetUpload: () => ({ mutateAsync: jest.fn() }),
  pickMeishiImage: jest.fn(),
}));

jest.mock("@/components/meishi/PropertyPanel", () => ({
  PropertyPanel: () => null,
}));

jest.mock("@/components/meishi/TemplatePicker", () => ({
  TemplatePicker: ({ visible }: { visible: boolean }) => {
    if (!visible) return null;
    const { Text } = require("react-native");
    return <Text>テンプレート選択</Text>;
  },
}));

jest.mock("@/components/meishi/TextEditSheet", () => ({
  TextEditSheet: () => null,
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

jest.mock("@/lib/achievements/useAchievements", () => ({
  useAchievements: () => ({ data: undefined }),
}));

jest.mock("@/lib/profileUrl", () => ({
  buildProfileUrl: (userId: string | null | undefined) =>
    userId ? `http://localhost:8081/user/${userId}` : null,
}));

// 画像共有のスナップショット描画・撮像は本テストの対象外。
jest.mock("@/lib/meishi/imageShare", () => ({
  useMeishiImageShare: () => ({
    shareImage: mockShareMeishiImage,
    isSharing: false,
    snapshotElement: null,
  }),
}));

const defaultDoc = {
  version: 1,
  canvas: {
    width: 360,
    height: 216,
    background: { type: "solid", color: "#ffffff" },
  },
  elements: [],
};
const docWithTextElement = {
  ...defaultDoc,
  elements: [
    {
      id: "el_1",
      type: "text",
      transform: { x: 0.1, y: 0.1, width: 0.3, height: 0.1, rotation: 0 },
      text: "テスト",
      source: "custom",
      fontSize: 16,
      fontFamily: "system",
      fontWeight: "normal",
      fontStyle: "normal",
      color: "#000000",
      align: "left",
    },
  ],
};
let mockDoc: Record<string, unknown> | null = defaultDoc;
let mockDocLoaded = true;

const mockUseMeishiDocument = jest.fn();
jest.mock("@/lib/meishi/useMeishiDocument", () => ({
  useMeishiDocument: (options?: unknown) => {
    mockUseMeishiDocument(options);
    return {
      doc: mockDoc,
      loaded: mockDocLoaded,
      setDocFromTemplate: jest.fn(),
      commit: jest.fn(),
      beginGesture: jest.fn(),
      setElementTransformLive: jest.fn(),
      updateElement: jest.fn(),
      addElement: jest.fn(),
      removeElement: jest.fn(),
      duplicateElement: jest.fn(),
      bringToFront: jest.fn(),
      sendToBack: jest.fn(),
      setBackground: jest.fn(),
      undo: jest.fn(),
      redo: jest.fn(),
      clear: jest.fn(),
      saveDocument: mockSaveDocument,
      reloadDocument: jest.fn(),
      canUndo: false,
      canRedo: false,
      boundCardId: null,
    };
  },
}));

// 画面が GestureDetector（名刺外タップの選択解除）を描画するため、
// GestureHandlerRootView の下に置かないと __DEV__ で例外になる。
const renderScreen = () =>
  render(
    <GestureHandlerRootView>
      <MeishiEditScreen />
    </GestureHandlerRootView>,
  );

beforeEach(async () => {
  mockDoc = defaultDoc;
  mockDocLoaded = true;
  mockSearchParams = {};
  mockUseMeishiDocument.mockClear();
  mockBack.mockClear();
  mockReplace.mockClear();
  mockDismissTo.mockClear();
  mockCanGoBack.mockReset();
  mockCanGoBack.mockReturnValue(true);
  mockSaveDocument.mockReset();
  mockSaveDocument.mockResolvedValue(undefined);
  mockShareMeishiImage.mockReset();
});

describe("MeishiEditScreen の保存フィードバック", () => {
  it("保存ボタン押下時にドキュメントを保存して上位レイヤーへ成功表示を出す", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByLabelText("保存"));

    await waitFor(() => {
      expect(mockSaveDocument).toHaveBeenCalledTimes(1);
      expect(screen.getByText("名刺を保存しました")).toBeTruthy();
    });

    const feedbackLayer = screen.getByTestId("meishi-save-feedback-layer");
    const layerStyle = StyleSheet.flatten(feedbackLayer.props.style);

    expect(feedbackLayer.props.pointerEvents).toBe("box-none");
    expect(layerStyle.position).toBe("absolute");
    expect(layerStyle.top).toBe(0);
    expect(layerStyle.left).toBe(0);
    expect(layerStyle.right).toBe(0);
    expect(layerStyle.zIndex).toBeGreaterThan(0);
  });

  it("保存トーストの「画像で共有」ボタンで名刺画像の共有を起動する", async () => {
    await renderScreen();

    await fireEvent.press(screen.getByLabelText("保存"));

    await waitFor(() => {
      expect(screen.getByTestId("meishi-save-share-image")).toBeTruthy();
    });

    await fireEvent.press(screen.getByTestId("meishi-save-share-image"));
    expect(mockShareMeishiImage).toHaveBeenCalledTimes(1);
  });
});

describe("MeishiEditScreen の初回テンプレート選択", () => {
  // 起動時の自動オープンはレンダー中の状態調整で行う（#267）
  it("ドキュメント読み込み完了時に空ならテンプレート選択を一度だけ開く", async () => {
    mockDoc = null;
    mockDocLoaded = true;
    const { rerender } = await renderScreen();

    expect(screen.getByText("テンプレート選択")).toBeTruthy();

    // 再レンダーを繰り返しても開いたまま（再レンダー上限にならない）
    await rerender(
      <GestureHandlerRootView>
        <MeishiEditScreen />
      </GestureHandlerRootView>,
    );
    expect(screen.getByText("テンプレート選択")).toBeTruthy();
  });

  it("ドキュメントが既にあるときはテンプレート選択を開かない", async () => {
    await renderScreen();
    expect(screen.queryByText("テンプレート選択")).toBeNull();
  });

  it("読み込み中（loaded=false）の間はテンプレート選択を開かない", async () => {
    mockDoc = null;
    mockDocLoaded = false;
    await renderScreen();
    expect(screen.queryByText("テンプレート選択")).toBeNull();
  });
});

describe("MeishiEditScreen の戻るボタン", () => {
  it("戻り先がある場合は履歴を戻る", async () => {
    mockCanGoBack.mockReturnValue(true);
    await renderScreen();

    await fireEvent.press(screen.getByLabelText("戻る"));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockSaveDocument).not.toHaveBeenCalled();
  });

  it("戻り先がない場合はプロフィールへ移動する", async () => {
    mockCanGoBack.mockReturnValue(false);
    await renderScreen();

    await fireEvent.press(screen.getByLabelText("戻る"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/profile");
    expect(mockSaveDocument).not.toHaveBeenCalled();
  });
});

describe("MeishiEditScreen の名刺一覧ボタン", () => {
  it("直前の画面が一覧とは限らないため、履歴を戻らず一覧ルートへ遷移する", async () => {
    mockSearchParams = { id: "card_a" };
    await renderScreen();

    await fireEvent.press(screen.getByLabelText("名刺一覧を開く"));

    expect(mockDismissTo).toHaveBeenCalledWith("/meishi");
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe("MeishiEditScreen のカード指定（issue #427）", () => {
  it("id パラメータがあるときそのカードを編集対象にする", async () => {
    mockSearchParams = { id: "card_a" };
    await renderScreen();

    expect(mockUseMeishiDocument).toHaveBeenCalledWith({ cardId: "card_a" });
  });

  it("create=1 のとき新規カードモードで開く", async () => {
    mockSearchParams = { create: "1" };
    await renderScreen();

    expect(mockUseMeishiDocument).toHaveBeenCalledWith({ fresh: true });
  });

  it("パラメータ無しではオプション無し（既定カード）で開く", async () => {
    await renderScreen();

    expect(mockUseMeishiDocument).toHaveBeenCalledWith(undefined);
  });
});

describe("MeishiEditScreen の要素選択解除（issue #494）", () => {
  it("名刺の外側（灰色の領域）をタップすると選択が解除され「要素を追加」に戻る", async () => {
    mockDoc = docWithTextElement;
    await renderScreen();

    // 名刺上の要素をタップして選択状態にする（編集パネル表示・追加ボタン非表示）
    await fireEvent.press(screen.getByLabelText("名刺の要素を選択"));
    expect(screen.queryByLabelText("要素を追加")).toBeNull();

    await act(async () => {
      fireGestureHandler(getByGestureTestId("meishi-canvas-backdrop-tap"));
    });

    await waitFor(() => {
      expect(screen.getByLabelText("要素を追加")).toBeTruthy();
    });
  });

  it("選択中はスクリーンリーダー向けの解除ボタンでも選択解除できる", async () => {
    mockDoc = docWithTextElement;
    await renderScreen();

    expect(screen.queryByLabelText("要素の選択を解除")).toBeNull();
    await fireEvent.press(screen.getByLabelText("名刺の要素を選択"));

    await fireEvent.press(screen.getByLabelText("要素の選択を解除"));

    await waitFor(() => {
      expect(screen.getByLabelText("要素を追加")).toBeTruthy();
    });
  });
});
