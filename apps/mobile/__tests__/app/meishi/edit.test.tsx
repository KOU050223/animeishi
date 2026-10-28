import React from "react";
import { StyleSheet } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import MeishiEditScreen from "@/app/meishi/edit";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockCanGoBack = jest.fn();
const mockSaveDocument = jest.fn();

jest.mock("expo-router", () => ({
  Stack: {
    Screen: () => null,
  },
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: mockCanGoBack,
  }),
}));

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

jest.mock("@/components/meishi/EditorCanvas", () => ({
  EditorCanvas: () => {
    const { Text } = require("react-native");
    return <Text>名刺キャンバス</Text>;
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

jest.mock("@/lib/profileUrl", () => ({
  buildProfileUrl: (userId: string | null | undefined) =>
    userId ? `http://localhost:8081/user/${userId}` : null,
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
let mockDoc: typeof defaultDoc | null = defaultDoc;
let mockDocLoaded = true;

jest.mock("@/lib/meishi/useMeishiDocument", () => ({
  useMeishiDocument: () => ({
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
  }),
}));

beforeEach(async () => {
  mockDoc = defaultDoc;
  mockDocLoaded = true;
  mockBack.mockClear();
  mockReplace.mockClear();
  mockCanGoBack.mockReset();
  mockCanGoBack.mockReturnValue(true);
  mockSaveDocument.mockReset();
  mockSaveDocument.mockResolvedValue(undefined);
});

describe("MeishiEditScreen の保存フィードバック", () => {
  it("保存ボタン押下時にドキュメントを保存して上位レイヤーへ成功表示を出す", async () => {
    await render(<MeishiEditScreen />);

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
});

describe("MeishiEditScreen の初回テンプレート選択", () => {
  // 起動時の自動オープンはレンダー中の状態調整で行う（#267）
  it("ドキュメント読み込み完了時に空ならテンプレート選択を一度だけ開く", async () => {
    mockDoc = null;
    mockDocLoaded = true;
    const { rerender } = await render(<MeishiEditScreen />);

    expect(screen.getByText("テンプレート選択")).toBeTruthy();

    // 再レンダーを繰り返しても開いたまま（再レンダー上限にならない）
    await rerender(<MeishiEditScreen />);
    expect(screen.getByText("テンプレート選択")).toBeTruthy();
  });

  it("ドキュメントが既にあるときはテンプレート選択を開かない", async () => {
    await render(<MeishiEditScreen />);
    expect(screen.queryByText("テンプレート選択")).toBeNull();
  });

  it("読み込み中（loaded=false）の間はテンプレート選択を開かない", async () => {
    mockDoc = null;
    mockDocLoaded = false;
    await render(<MeishiEditScreen />);
    expect(screen.queryByText("テンプレート選択")).toBeNull();
  });
});

describe("MeishiEditScreen の戻るボタン", () => {
  it("戻り先がある場合は履歴を戻る", async () => {
    mockCanGoBack.mockReturnValue(true);
    await render(<MeishiEditScreen />);

    await fireEvent.press(screen.getByLabelText("戻る"));

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockSaveDocument).not.toHaveBeenCalled();
  });

  it("戻り先がない場合はプロフィールへ移動する", async () => {
    mockCanGoBack.mockReturnValue(false);
    await render(<MeishiEditScreen />);

    await fireEvent.press(screen.getByLabelText("戻る"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/(tabs)/profile");
    expect(mockSaveDocument).not.toHaveBeenCalled();
  });
});
