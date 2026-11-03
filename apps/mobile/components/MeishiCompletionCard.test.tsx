import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { MeishiCompletionCard } from "@/components/MeishiCompletionCard";
import type { MeishiCompletion } from "@/lib/meishi/useMeishiCompletion";

// 判定ロジックは lib/meishi/completion の単体テスト側で検証する。
// ここではフックの戻り値を差し替えてカードの UI 分岐と遷移を検証する。
let mockCompletion: MeishiCompletion;
const mockReload = jest.fn();
const mockPush = jest.fn();

jest.mock("@/lib/meishi/useMeishiCompletion", () => ({
  useMeishiCompletion: () => mockCompletion,
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  // フォーカス時の再読み込み。テストでは即時実行に差し替える。
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(effect, [effect]);
  },
}));

function completion(
  missing: MeishiCompletion["missing"],
  overrides: Partial<MeishiCompletion> = {},
): MeishiCompletion {
  return {
    missing,
    isComplete: missing.length === 0,
    isLoading: false,
    isError: false,
    document: null,
    reload: mockReload,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCompletion = completion([
    "avatar",
    "displayName",
    "favorites",
    "template",
  ]);
});

describe("MeishiCompletionCard", () => {
  it("未達の件数を「残り N ステップ」で表示する", async () => {
    await render(<MeishiCompletionCard />);
    expect(
      screen.getByText("名刺を完成させよう（残り 4 ステップ）"),
    ).toBeTruthy();
  });

  it("未達の項目をタップすると該当画面へ遷移する", async () => {
    await render(<MeishiCompletionCard />);

    await fireEvent.press(screen.getByTestId("meishi-completion-step-avatar"));
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/profile");

    await fireEvent.press(
      screen.getByTestId("meishi-completion-step-favorites"),
    );
    expect(mockPush).toHaveBeenCalledWith("/(tabs)/library?section=anime");

    await fireEvent.press(
      screen.getByTestId("meishi-completion-step-template"),
    );
    expect(mockPush).toHaveBeenCalledWith("/meishi/edit");
  });

  it("達成済みの項目はタップ導線を出さない", async () => {
    mockCompletion = completion(["template"]);
    await render(<MeishiCompletionCard />);

    // 達成済みはチェック表示だけで遷移ボタンを出さない
    expect(screen.queryByTestId("meishi-completion-step-avatar")).toBeNull();
    expect(
      screen.queryByTestId("meishi-completion-step-displayName"),
    ).toBeNull();
    expect(screen.queryByTestId("meishi-completion-step-favorites")).toBeNull();
    // 達成済みでも進捗は見せる
    expect(screen.getByText("アイコン")).toBeTruthy();
    expect(
      screen.getByText("名刺を完成させよう（残り 1 ステップ）"),
    ).toBeTruthy();
  });

  it("4 点すべて満たしたらカードを出さない", async () => {
    mockCompletion = completion([]);
    await render(<MeishiCompletionCard />);
    expect(screen.queryByTestId("meishi-completion-card")).toBeNull();
  });

  it("判定データの読み込み中はカードを出さない", async () => {
    mockCompletion = completion(["avatar"], { isLoading: true });
    await render(<MeishiCompletionCard />);
    expect(screen.queryByTestId("meishi-completion-card")).toBeNull();
  });

  it("プロフィール・推しの取得失敗時は未達と誤判定せずカードを出さない", async () => {
    mockCompletion = completion(["avatar", "displayName", "favorites"], {
      isError: true,
    });
    await render(<MeishiCompletionCard />);
    expect(screen.queryByTestId("meishi-completion-card")).toBeNull();
  });
});
