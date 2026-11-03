import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import OnboardingScreen from "@/app/onboarding";
import { onboardingPending } from "@/lib/onboarding";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

// issue #412: 初回オンボーディング画面のオーケストレーション。
// ステップ各画面の UI はモックに置き換え、ここでは
// エントリ判定（pending / fresh / 記録済み）・ステップ遷移・
// お気に入り保存・名刺ライブラリへのカード保存・完了/スキップ記録を検証する。

const mockReplace = jest.fn();
const mockRedirect = jest.fn();
let mockParams: { fresh?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace }),
  useLocalSearchParams: () => mockParams,
  Redirect: ({ href }: { href: string }) => {
    mockRedirect(href);
    return null;
  },
}));

const mockMutateAsync = jest.fn().mockResolvedValue({});
jest.mock("@/lib/useFavorites", () => ({
  useAddFavorite: () => ({ mutateAsync: mockMutateAsync }),
}));

function fakeWork(annictWorkId: number) {
  return {
    annictWorkId,
    nodeId: `node-${annictWorkId}`,
    state: null,
    title: `候補作品${annictWorkId}`,
    titleKana: null,
    titleEn: null,
    seasonName: null,
    seasonYear: null,
    imageUrl: null,
    malAnimeId: null,
    watchersCount: 10,
    resolvedImageUrl: null,
    hostedImageUrl: null,
    genres: null,
  };
}
const mockFakeWorks = [fakeWork(101), fakeWork(102), fakeWork(103)];

// ステップ部品は props のコールバックを testID 経由で叩けるだけの
// モックに置き換える。各ステップの UI 自体はこのテストの対象外。
jest.mock("@/components/onboarding/FavoriteWorksStep", () => ({
  ONBOARDING_FAVORITE_COUNT: 3,
  FavoriteWorksStep: (props: {
    selected: { annictWorkId: number }[];
    onToggle: (w: unknown) => void;
    onNext: () => void;
    onSkip: () => void;
    saving: boolean;
    error: string | null;
  }) => {
    const { Pressable, Text, View } = require("react-native");
    return (
      <View testID="step-favorites">
        <Text testID="mock-selected-count">{props.selected.length}</Text>
        {props.error ? <Text testID="mock-error">{props.error}</Text> : null}
        {mockFakeWorks.map((w) => (
          <Pressable
            key={w.annictWorkId}
            testID={`mock-toggle-${w.annictWorkId}`}
            onPress={() => props.onToggle(w)}
          />
        ))}
        <Pressable testID="mock-next" onPress={props.onNext} />
        <Pressable testID="mock-skip" onPress={props.onSkip} />
      </View>
    );
  },
}));

jest.mock("@/components/onboarding/TemplateStep", () => ({
  TemplateStep: (props: {
    selectedTemplateId: string | null;
    onSelect: (id: string) => void;
    onNext: () => void;
    onSkip: () => void;
    saving: boolean;
    error: string | null;
  }) => {
    const { Pressable, Text, View } = require("react-native");
    return (
      <View testID="step-template">
        <Text testID="mock-template-id">{props.selectedTemplateId}</Text>
        {props.error ? <Text testID="mock-error">{props.error}</Text> : null}
        <Pressable
          testID="mock-select-template"
          onPress={() => props.onSelect("classic")}
        />
        <Pressable testID="mock-next" onPress={props.onNext} />
        <Pressable testID="mock-skip" onPress={props.onSkip} />
      </View>
    );
  },
}));

jest.mock("@/components/onboarding/CompletionStep", () => ({
  CompletionStep: (props: { onNext: () => void; onSkip: () => void }) => {
    const { Pressable, View } = require("react-native");
    return (
      <View testID="step-completion">
        <Pressable testID="mock-next" onPress={props.onNext} />
        <Pressable testID="mock-skip" onPress={props.onSkip} />
      </View>
    );
  },
}));

jest.mock("@/components/onboarding/AnnictStep", () => ({
  AnnictStep: (props: { onNext: () => void; onSkip: () => void }) => {
    const { Pressable, View } = require("react-native");
    return (
      <View testID="step-annict">
        <Pressable testID="mock-next" onPress={props.onNext} />
        <Pressable testID="mock-skip" onPress={props.onSkip} />
      </View>
    );
  },
}));

const STATUS_KEY = "onboarding:status:v1:user_test";
const LIBRARY_KEY = "meishi-library:v1";

async function selectThreeWorksAndNext() {
  for (const id of [101, 102, 103]) {
    await fireEvent.press(screen.getByTestId(`mock-toggle-${id}`));
  }
  await fireEvent.press(screen.getByTestId("mock-next"));
  expect(await screen.findByTestId("step-template")).toBeTruthy();
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  mockParams = {};
  onboardingPending.current = false;
  await AsyncStorage.clear();
  loggedInUser();
});

describe("OnboardingScreen エントリ判定", () => {
  it("pending でも fresh でもない直打ちはホームへリダイレクトする", async () => {
    await render(<OnboardingScreen />);
    expect(mockRedirect).toHaveBeenCalledWith("/");
  });

  it("onboardingPending が立っていれば 1 問目を表示する", async () => {
    onboardingPending.current = true;
    await render(<OnboardingScreen />);
    expect(screen.getByTestId("step-favorites")).toBeTruthy();
  });

  it("fresh=1（Web OAuth 着地）でも pending 無しで表示する", async () => {
    mockParams = { fresh: "1" };
    await render(<OnboardingScreen />);
    expect(screen.getByTestId("step-favorites")).toBeTruthy();
  });

  it("完了/スキップ記録済みのユーザーはホームへ戻す", async () => {
    onboardingPending.current = true;
    await AsyncStorage.setItem(
      STATUS_KEY,
      JSON.stringify({ status: "completed", finishedAt: 1 }),
    );

    await render(<OnboardingScreen />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
  });
});

describe("OnboardingScreen フロー", () => {
  beforeEach(() => {
    onboardingPending.current = true;
  });

  it("3 作選択 → テンプレート → 完成 → Annict で completed を記録する", async () => {
    await render(<OnboardingScreen />);

    // 1 問目: 3 作を選ぶ
    await selectThreeWorksAndNext();

    // 選んだ 3 作がお気に入りとして保存される
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledTimes(3);
    });
    expect(mockMutateAsync.mock.calls.map((c) => c[0])).toEqual([
      101, 102, 103,
    ]);

    // 2 問目: テンプレートを選んで進むと名刺ライブラリにカードが保存される
    await fireEvent.press(screen.getByTestId("mock-select-template"));
    await fireEvent.press(screen.getByTestId("mock-next"));
    expect(await screen.findByTestId("step-completion")).toBeTruthy();
    const savedLibrary = JSON.parse((await AsyncStorage.getItem(LIBRARY_KEY))!);
    expect(savedLibrary.cards).toHaveLength(1);
    // 最初の 1 枚は既定カードになる
    expect(savedLibrary.defaultCardId).toBe(savedLibrary.cards[0].id);

    // 3 問目（名刺完成）→ 4 問目（Annict）
    await fireEvent.press(screen.getByTestId("mock-next"));
    expect(await screen.findByTestId("step-annict")).toBeTruthy();

    // 最後の質問を抜けると completed を記録してホームへ
    await fireEvent.press(screen.getByTestId("mock-next"));
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    const record = JSON.parse((await AsyncStorage.getItem(STATUS_KEY))!);
    expect(record.status).toBe("completed");
  });

  it("既にカードがあるライブラリでは既定を奪わず追加だけする", async () => {
    await AsyncStorage.setItem(
      LIBRARY_KEY,
      JSON.stringify({
        version: 1,
        defaultCardId: "existing-card",
        cards: [
          {
            id: "existing-card",
            name: "名刺 1",
            document: { version: 1, canvas: {}, elements: [] },
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }),
    );

    await render(<OnboardingScreen />);
    await selectThreeWorksAndNext();
    await fireEvent.press(screen.getByTestId("mock-select-template"));
    await fireEvent.press(screen.getByTestId("mock-next"));

    expect(await screen.findByTestId("step-completion")).toBeTruthy();
    const savedLibrary = JSON.parse((await AsyncStorage.getItem(LIBRARY_KEY))!);
    expect(savedLibrary.cards).toHaveLength(2);
    // 既定は既存カードのまま（オンボーディングのカードは奪わない）
    expect(savedLibrary.defaultCardId).toBe("existing-card");
  });

  it("途中のスキップは skipped を記録してホームへ戻る", async () => {
    await render(<OnboardingScreen />);
    await fireEvent.press(screen.getByTestId("mock-skip"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    const record = JSON.parse((await AsyncStorage.getItem(STATUS_KEY))!);
    expect(record.status).toBe("skipped");
  });

  it("推しの保存に失敗したらエラーを表示して 1 問目に留まる", async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error("network"));
    await render(<OnboardingScreen />);

    for (const id of [101, 102, 103]) {
      await fireEvent.press(screen.getByTestId(`mock-toggle-${id}`));
    }
    await fireEvent.press(screen.getByTestId("mock-next"));

    expect(await screen.findByTestId("mock-error")).toBeTruthy();
    expect(screen.queryByTestId("step-template")).toBeNull();
  });

  it("名刺の保存に失敗したらエラーを表示して 2 問目に留まる", async () => {
    // ライブラリ書き込み（multiSet）だけ失敗させる。
    // storage 層は失敗を握りつぶすため、画面側の読み直し確認で検出する。
    const multiSet = jest
      .spyOn(AsyncStorage, "multiSet")
      .mockRejectedValue(new Error("storage full"));

    await render(<OnboardingScreen />);
    await selectThreeWorksAndNext();
    await fireEvent.press(screen.getByTestId("mock-select-template"));
    await fireEvent.press(screen.getByTestId("mock-next"));

    expect(await screen.findByTestId("mock-error")).toBeTruthy();
    expect(screen.queryByTestId("step-completion")).toBeNull();
    // 完了記録は書かれない
    expect(await AsyncStorage.getItem(STATUS_KEY)).toBeNull();
    multiSet.mockRestore();
  });

  it("未選択のままテンプレートの「次へ」を押しても進まない", async () => {
    await render(<OnboardingScreen />);
    await selectThreeWorksAndNext();

    // onSelect せずに next（テンプレート未選択）
    await fireEvent.press(screen.getByTestId("mock-next"));
    expect(screen.queryByTestId("step-completion")).toBeNull();
    expect(screen.getByTestId("step-template")).toBeTruthy();
  });
});
