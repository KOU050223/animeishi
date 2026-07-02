import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import ProfileScreen from "@/app/(tabs)/profile";

const mockMutateProfile = jest.fn();

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
  mockMutateProfile.mockImplementation((_input, options) => {
    options?.onSuccess?.();
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
