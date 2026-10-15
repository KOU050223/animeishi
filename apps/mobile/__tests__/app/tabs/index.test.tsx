import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import HomeScreen from "@/app/(tabs)/index";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

// react-query の useQueryClient はキャッシュクリア用。本テストでは未使用。
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ resetQueries: jest.fn() }),
}));

// HomeScreen が import する AsyncStorage はネイティブモジュール依存のためモックする。
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// フォーカス時の名刺ドキュメント再読み込み。テストでは即時実行に差し替える。
jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(effect, [effect]);
  },
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
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

// 連携状態をテストごとに切り替えられるよう、変数経由で返す。
let mockAnnictConnection = { isConnected: false, isLoading: false };
jest.mock("@/lib/annict", () => ({
  useAnnictConnection: () => mockAnnictConnection,
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
}));

jest.mock("@/lib/meishi/useMeishiDocument", () => ({
  useMeishiDocument: () => ({
    doc: null,
    reloadDocument: jest.fn(),
  }),
}));

jest.mock("@/lib/profileUrl", () => ({
  buildProfileUrl: () => "https://animeishi.uomi.dev/user/user_1",
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  mockAnnictConnection = { isConnected: false, isLoading: false };
});

describe("HomeScreen", () => {
  it("名刺プレビューと主要導線が表示される", () => {
    loggedInUser();
    render(<HomeScreen />);
    expect(screen.getByTestId("home-meishi-preview")).toBeTruthy();
    expect(screen.getByTestId("home-open-meishi-edit")).toBeTruthy();
    expect(screen.getByTestId("home-open-qr")).toBeTruthy();
    expect(screen.getByText("Annict連携")).toBeTruthy();
  });

  it("名刺デザイン導線で名刺エディタへ遷移する", () => {
    loggedInUser();
    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId("home-open-meishi-edit"));
    expect(mockPush).toHaveBeenCalledWith("/meishi/edit");
  });

  it("QR 導線で QR 画面へ遷移する", () => {
    loggedInUser();
    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId("home-open-qr"));
    expect(mockPush).toHaveBeenCalledWith("/qr");
  });

  it("Annict 連携済みなら連携カードを表示しない（確認・解除はプロフィールに集約）", () => {
    mockAnnictConnection = { isConnected: true, isLoading: false };
    loggedInUser();
    render(<HomeScreen />);
    expect(screen.queryByText("Annict連携")).toBeNull();
  });

  it("Annict 連携状態の読み込み中は連携カードを表示しない", () => {
    mockAnnictConnection = { isConnected: false, isLoading: true };
    loggedInUser();
    render(<HomeScreen />);
    expect(screen.queryByText("Annict連携")).toBeNull();
  });

  it("サインアウトボタンが表示される", () => {
    loggedInUser();
    render(<HomeScreen />);
    expect(screen.getByTestId("sign-out-button")).toBeTruthy();
  });

  it("サインアウトボタンを押すと signOut が呼ばれる", async () => {
    const auth = loggedInUser();

    render(<HomeScreen />);
    fireEvent.press(screen.getByTestId("sign-out-button"));

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(1);
    });
    expect(auth.isSignedIn).toBe(false);
  });

  it("サインアウトボタンを連打しても signOut が押下回数ぶん呼ばれる（多重呼び出しで破綻しない）", async () => {
    const auth = loggedInUser();

    render(<HomeScreen />);
    const button = screen.getByTestId("sign-out-button");
    fireEvent.press(button);
    fireEvent.press(button);
    fireEvent.press(button);

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(3);
    });
  });
});
