import React from "react";
import { StyleSheet } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import ProfileScreen from "@/app/(tabs)/profile";
import { getAuthMock, resetAuth } from "@/test-utils/auth";

const mockMutateProfile = jest.fn();
const mockDeleteAccount = jest.fn();
const mockReloadDocument = jest.fn();
const mockConfirm = jest.fn();

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(effect, [effect]);
  },
}));

jest.mock("@/components/MeishiCard", () => ({
  MeishiCard: () => {
    const { Text } = require("react-native");
    return <Text>名刺プレビュー本体</Text>;
  },
}));

jest.mock("@/components/AnnictConnectionCard", () => ({
  AnnictConnectionCard: () => {
    const { Text } = require("react-native");
    return <Text>Annict連携</Text>;
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
      isPublic: true,
      createdAt: "",
      updatedAt: "",
    },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  }),
  useUpdateProfile: () => ({
    isPending: false,
    mutate: mockMutateProfile,
  }),
  useDeleteAccount: () => ({
    isPending: false,
    mutateAsync: mockDeleteAccount,
  }),
}));

jest.mock("@/lib/dialog", () => ({
  confirm: (...args: unknown[]) => mockConfirm(...args),
  alert: jest.fn(),
}));

jest.mock("@/lib/annict/storage", () => ({
  annictTokenStorage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    remove: jest.fn(async () => {}),
  },
}));

jest.mock("@/lib/useProfileAvatar", () => ({
  useProfileAvatarUpload: () => ({
    isPending: false,
    mutate: jest.fn(),
  }),
}));

jest.mock("@/lib/meishi/useMeishiDocument", () => ({
  useMeishiDocument: () => ({
    doc: null,
    loaded: true,
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
    saveDocument: jest.fn(),
    reloadDocument: mockReloadDocument,
    canUndo: false,
    canRedo: false,
  }),
}));

jest.mock("@/lib/profileUrl", () => ({
  buildProfileUrl: (userId: string | null | undefined) =>
    userId ? `http://localhost:8081/user/${userId}` : null,
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  mockMutateProfile.mockImplementation((_input, options) => {
    options?.onSuccess?.();
  });
  mockDeleteAccount.mockResolvedValue(null);
});

describe("ProfileScreen の名刺プレビュー", () => {
  it("画面フォーカス時に名刺ドキュメントを再読み込みする", () => {
    render(<ProfileScreen />);

    expect(mockReloadDocument).toHaveBeenCalledTimes(1);
  });
});

describe("ProfileScreen の保存トースト", () => {
  it("保存成功時のトーストをスクロール内容とは別の上位レイヤーに表示する", () => {
    render(<ProfileScreen />);

    fireEvent.press(screen.getByLabelText("プロフィールを保存"));

    expect(screen.getByText("プロフィールを保存しました")).toBeTruthy();

    const toastLayer = screen.getByTestId("profile-toast-layer");
    const layerStyle = StyleSheet.flatten(toastLayer.props.style);

    expect(toastLayer.props.pointerEvents).toBe("box-none");
    expect(layerStyle.position).toBe("absolute");
    expect(layerStyle.top).toBe(0);
    expect(layerStyle.left).toBe(0);
    expect(layerStyle.right).toBe(0);
    expect(layerStyle.zIndex).toBeGreaterThan(0);
  });
});

describe("ProfileScreen のアカウント削除", () => {
  it("削除ボタン押下で二段階確認が出て、承諾すると削除→サインアウトされる", async () => {
    render(<ProfileScreen />);

    fireEvent.press(screen.getByLabelText("アカウントを削除"));

    // 1 段目の確認で承諾すると 2 段目（最終確認）が出る
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    const onFirstConfirm = mockConfirm.mock.calls[0][2] as () => void;
    onFirstConfirm();
    expect(mockConfirm).toHaveBeenCalledTimes(2);

    // 2 段目で承諾すると削除 API が呼ばれ、成功後にサインアウトする
    const onFinalConfirm = mockConfirm.mock.calls[1][2] as () => void;
    onFinalConfirm();
    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(getAuthMock().signOut).toHaveBeenCalledTimes(1);
    });
  });

  it("1 段目でキャンセル（confirm 未承諾）なら削除は実行されない", () => {
    render(<ProfileScreen />);

    fireEvent.press(screen.getByLabelText("アカウントを削除"));

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockDeleteAccount).not.toHaveBeenCalled();
    expect(getAuthMock().signOut).not.toHaveBeenCalled();
  });

  it("削除 API が失敗したらエラートーストを表示しサインアウトしない", async () => {
    mockDeleteAccount.mockRejectedValueOnce(
      new Error("アカウントの削除に失敗しました"),
    );
    render(<ProfileScreen />);

    fireEvent.press(screen.getByLabelText("アカウントを削除"));
    (mockConfirm.mock.calls[0][2] as () => void)();
    (mockConfirm.mock.calls[1][2] as () => void)();

    await waitFor(() => {
      expect(screen.getByText("アカウントの削除に失敗しました")).toBeTruthy();
    });
    expect(getAuthMock().signOut).not.toHaveBeenCalled();
  });
});
