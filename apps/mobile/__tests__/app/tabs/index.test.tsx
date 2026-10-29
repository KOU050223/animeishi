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

const mockPush = jest.fn();
// フォーカス時の名刺ドキュメント再読み込み。テストでは即時実行に差し替える。
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
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

// 連携状態をテストごとに切り替えられるよう、変数経由で返す。
// バレル（@/lib/annict）ごと潰すと useAnimeList が使う buildAnnictAuthHeader 等が
// undefined になるため、解決先のプラットフォーム実装モジュールを直接モックする。
let mockAnnictConnection = { isConnected: false, isLoading: false };
jest.mock("@/lib/annict/useAnnictConnection", () => ({
  useAnnictConnection: () => mockAnnictConnection,
  buildAnnictAuthHeader: async () => ({}),
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

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  mockAnnictConnection = { isConnected: false, isLoading: false };
});

describe("HomeScreen", () => {
  it("名刺プレビューと主要導線が表示される", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByTestId("home-meishi-preview")).toBeTruthy();
    expect(screen.getByTestId("home-open-meishi-edit")).toBeTruthy();
    expect(screen.getByTestId("home-open-qr")).toBeTruthy();
    expect(screen.getByText("Annict連携")).toBeTruthy();
  });

  it("名刺デザイン導線で名刺エディタへ遷移する", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("home-open-meishi-edit"));
    expect(mockPush).toHaveBeenCalledWith("/meishi/edit");
  });

  it("QR 導線で QR 画面へ遷移する", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("home-open-qr"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/social?section=qr");
  });

  it("Annict 連携済みなら連携カードを表示しない（確認・解除はプロフィールに集約）", async () => {
    mockAnnictConnection = { isConnected: true, isLoading: false };
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.queryByText("Annict連携")).toBeNull();
  });

  it("Annict 連携状態の読み込み中は連携カードを表示しない", async () => {
    mockAnnictConnection = { isConnected: false, isLoading: true };
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.queryByText("Annict連携")).toBeNull();
  });

  it("サインアウトボタンが表示される", async () => {
    loggedInUser();
    await render(<HomeScreen />);
    expect(screen.getByTestId("sign-out-button")).toBeTruthy();
  });

  it("サインアウトボタンを押すと signOut が呼ばれる", async () => {
    const auth = loggedInUser();

    await render(<HomeScreen />);
    await fireEvent.press(screen.getByTestId("sign-out-button"));

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(1);
    });
    expect(auth.isSignedIn).toBe(false);
  });

  it("サインアウトボタンを連打しても signOut が押下回数ぶん呼ばれる（多重呼び出しで破綻しない）", async () => {
    const auth = loggedInUser();

    await render(<HomeScreen />);
    const button = screen.getByTestId("sign-out-button");
    await fireEvent.press(button);
    await fireEvent.press(button);
    await fireEvent.press(button);

    await waitFor(() => {
      expect(auth.signOut).toHaveBeenCalledTimes(3);
    });
  });
});
