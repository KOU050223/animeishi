import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import ProfileScreen from "@/app/(tabs)/profile/index";

const mockMutateProfile = jest.fn();
const mockReloadDocument = jest.fn();

jest.mock("expo-router/react-navigation", () => ({
  useHeaderHeight: () => 0,
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
  }),
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

jest.mock("@/components/AppVersionFooter", () => ({
  AppVersionFooter: () => {
    const { Text } = require("react-native");
    return <Text>バージョン情報</Text>;
  },
}));

// 取得結果をテストごとに切り替えられるよう、変数経由で返す。
const mockProfileData = {
  id: "user_1",
  username: "テストユーザー",
  bio: "",
  favoriteQuote: "",
  profileImageUrl: null,
  isPublic: true,
  createdAt: "",
  updatedAt: "",
};
let mockProfile: {
  data: typeof mockProfileData | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

jest.mock("@/lib/useProfile", () => ({
  useProfile: () => mockProfile,
  useUpdateProfile: () => ({
    isPending: false,
    mutate: mockMutateProfile,
  }),
  useDeleteAccount: () => ({
    isPending: false,
    mutateAsync: jest.fn(),
  }),
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

beforeEach(async () => {
  jest.clearAllMocks();
  mockProfile = {
    data: mockProfileData,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
  };
  mockMutateProfile.mockImplementation((_input, options) => {
    options?.onSuccess?.();
  });
});

describe("ProfileScreen の名刺プレビュー", () => {
  it("画面フォーカス時に名刺ドキュメントを再読み込みする", async () => {
    await render(<ProfileScreen />);

    expect(mockReloadDocument).toHaveBeenCalledTimes(1);
  });
});

describe("ProfileScreen の保存トースト", () => {
  it("保存成功時のトーストをスクロール内容とは別の上位レイヤーに表示する", async () => {
    await render(<ProfileScreen />);

    await fireEvent.press(screen.getByLabelText("プロフィールを保存"));

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

describe("ProfileScreen の Annict 連携セクション", () => {
  it("連携状態の確認・解除カードを表示する（ホームからここへ集約）", async () => {
    await render(<ProfileScreen />);

    expect(screen.getByText("Annict連携")).toBeTruthy();
  });

  it("プロフィール取得エラー時も連携カードを表示する（解除導線を残す）", async () => {
    mockProfile = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: jest.fn(),
    };
    await render(<ProfileScreen />);

    expect(screen.getByText("Annict連携")).toBeTruthy();
  });
});

describe("ProfileScreen のアカウント削除導線", () => {
  it("アカウント削除セクションが表示される（本体の挙動は DeleteAccountSection のテストを参照）", async () => {
    await render(<ProfileScreen />);

    expect(screen.getByLabelText("アカウントを削除")).toBeTruthy();
  });
});

describe("ProfileScreen のアプリ情報セクション", () => {
  it("機能一覧・更新情報への導線を表示する", async () => {
    await render(<ProfileScreen />);

    expect(screen.getByLabelText("機能一覧・更新情報を開く")).toBeTruthy();
  });
});

describe("ProfileScreen の法務情報セクション", () => {
  it("プライバシーポリシー・利用規約・サポートへの導線を表示する", async () => {
    await render(<ProfileScreen />);

    expect(screen.getByLabelText("プライバシーポリシーを開く")).toBeTruthy();
    expect(screen.getByLabelText("利用規約を開く")).toBeTruthy();
    expect(screen.getByLabelText("サポートを開く")).toBeTruthy();
  });

  it("MyAnimeList の帰属表示を表示する", async () => {
    await render(<ProfileScreen />);

    expect(
      screen.getByText("作品画像の一部は MyAnimeList から取得しています"),
    ).toBeTruthy();
  });
});
