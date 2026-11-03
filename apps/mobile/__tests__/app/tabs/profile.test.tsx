import React from "react";
import { StyleSheet } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import ProfileScreen from "@/app/(tabs)/profile/index";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

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

jest.mock("@/components/profile/AnnictConnectionStatusRow", () => ({
  AnnictConnectionStatusRow: () => {
    const { Text } = require("react-native");
    return <Text>Annict連携ステータス</Text>;
  },
}));

jest.mock("@/components/AppVersionFooter", () => ({
  AppVersionFooter: () => {
    const { Text } = require("react-native");
    return <Text>バージョン情報</Text>;
  },
}));

// 吹き出しタップで開く作品詳細シート（issue #420）。シート本体の挙動は
// 別テストに任せ、ここでは「開いたか・対象作品が正しいか」だけを見る。
jest.mock("@/components/anime-list", () => ({
  AnimeWorkDetailSheet: ({ work }: { work: { title: string } | null }) => {
    const { Text } = require("react-native");
    return work ? <Text testID="work-detail-sheet">{work.title}</Text> : null;
  },
}));

jest.mock("@/lib/useFavorites", () => ({
  useFavoriteIds: () => new Set<number>(),
  useToggleFavorite: () => ({ toggle: jest.fn(), isPending: false }),
}));

jest.mock("@/lib/useWorkEpisodes", () => ({
  useWorkEpisodes: () => ({ data: undefined }),
}));

jest.mock("@/lib/events", () => ({ trackEvent: jest.fn() }));

const NOW_WATCHING = {
  annictWorkId: 3002,
  annictEpisodeId: 502,
  title: "新作アニメ",
  titleEn: null,
  seasonName: "2026-autumn",
  seasonYear: 2026,
  hostedImageUrl: null,
  // 吹き出しは記録から 24 時間で消えるため、常に期限内になるよう
  // 固定日時ではなく実行時刻から生成する。
  recordedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
};

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
  nowWatching: null as typeof NOW_WATCHING | null,
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

jest.mock("@/lib/meishi/useMeishiLibrary", () => ({
  useMeishiLibrary: () => ({
    cards: [],
    defaultCard: null,
    loaded: true,
    addCard: jest.fn(),
    duplicateCard: jest.fn(),
    removeCard: jest.fn(),
    setDefault: jest.fn(),
    updateCardDocument: jest.fn(),
    reload: mockReloadDocument,
  }),
}));

jest.mock("@/lib/profileUrl", () => ({
  buildProfileUrl: (userId: string | null | undefined) =>
    userId ? `http://localhost:8081/user/${userId}` : null,
}));

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
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

  it("画面フォーカス時にプロフィールを再取得する（いま見ているの追従）", async () => {
    await render(<ProfileScreen />);

    expect(mockProfile.refetch).toHaveBeenCalled();
  });
});

// issue #420: 直近 24h の話数記録を名刺内アバターの上に吹き出しで出す。
describe("ProfileScreen の「いま見ている」吹き出し", () => {
  function profileWithNowWatching(nowWatching: typeof NOW_WATCHING | null) {
    mockProfile = {
      data: { ...mockProfileData, nowWatching },
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
    };
  }

  it("nowWatching があると吹き出しを表示し、タップで作品詳細シートが開く", async () => {
    loggedInUser({ userId: "user_1" });
    profileWithNowWatching(NOW_WATCHING);
    await render(<ProfileScreen />);

    // 吹き出しのアンカーはプレビュー枠の実幅から計算するため、
    // レイアウト確定を再現してから出る。
    await fireEvent(screen.getByTestId("meishi-preview-frame"), "layout", {
      nativeEvent: { layout: { width: 320, height: 200 } },
    });

    await waitFor(() =>
      expect(screen.getByTestId("now-watching-bubble")).toBeTruthy(),
    );
    expect(screen.getByText("新作アニメ")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("now-watching-bubble"));

    await waitFor(() =>
      expect(screen.getByTestId("work-detail-sheet")).toBeTruthy(),
    );
    expect(screen.getByTestId("work-detail-sheet")).toHaveTextContent(
      "新作アニメ",
    );
  });

  it("nowWatching が null なら吹き出しを出さない", async () => {
    loggedInUser({ userId: "user_1" });
    profileWithNowWatching(null);
    await render(<ProfileScreen />);

    expect(screen.queryByTestId("now-watching-bubble")).toBeNull();
  });

  it("記録から 24 時間を過ぎていれば吹き出しを出さない", async () => {
    loggedInUser({ userId: "user_1" });
    profileWithNowWatching({
      ...NOW_WATCHING,
      recordedAt: new Date(
        Date.now() - 24 * 60 * 60 * 1000 - 60 * 1000,
      ).toISOString(),
    });
    await render(<ProfileScreen />);

    await fireEvent(screen.getByTestId("meishi-preview-frame"), "layout", {
      nativeEvent: { layout: { width: 320, height: 200 } },
    });

    // 期限切れの判定はタイマーコールバックで行うため、非表示になるまで待つ
    await waitFor(() =>
      expect(screen.queryByTestId("now-watching-bubble")).toBeNull(),
    );
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

  it("画面上部に連携状態の 1 行表示を出す（スクロール不要で状態が分かる）", async () => {
    await render(<ProfileScreen />);

    expect(screen.getByText("Annict連携ステータス")).toBeTruthy();
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

describe("ProfileScreen のサインアウト導線", () => {
  it("サインアウトボタンを押すと signOut が呼ばれる（ホームからここへ集約）", async () => {
    const auth = loggedInUser();

    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByTestId("sign-out-button"));

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.isSignedIn).toBe(false);
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
