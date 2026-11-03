import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import DeleteAccountScreen from "@/app/delete-account";
import type { MeishiDocument } from "@/lib/meishi/types";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockMutateFeedback = jest.fn();
const mockDeleteAccount = jest.fn();
const mockAlert = jest.fn();
const mockAnnictTokenRemove = jest.fn(async () => {});
const mockLoadMeishiDocument = jest.fn(
  async (): Promise<MeishiDocument | null> => null,
);
const mockClearMeishiDocument = jest.fn(async () => {});
const mockRefetchSummary = jest.fn();
let mockCanGoBack = true;
let mockSummary: {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

jest.mock("expo-router", () => ({
  // Stack.Screen の options を描画する。画面が headerLeft / title として
  // 渡したもの（戻るボタンの testID・画面タイトル）をテストできるようにする。
  Stack: {
    Screen: ({ options }: any) => {
      const { Text } = require("react-native");
      return (
        <>
          {options?.headerLeft ? options.headerLeft({}) : null}
          {options?.title ? <Text>{options.title}</Text> : null}
        </>
      );
    },
  },
  useRouter: () => ({
    canGoBack: () => mockCanGoBack,
    back: mockBack,
    replace: mockReplace,
  }),
}));

jest.mock("@/lib/useProfile", () => ({
  useDeletionSummary: () => mockSummary,
  useSubmitDeletionFeedback: () => ({
    mutate: (...args: unknown[]) => mockMutateFeedback(...args),
  }),
  useDeleteAccount: () => ({
    mutateAsync: mockDeleteAccount,
    isPending: false,
  }),
}));

jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
}));

jest.mock("@/lib/annict/storage", () => ({
  annictTokenStorage: {
    get: jest.fn(async () => null),
    set: jest.fn(async () => {}),
    remove: () => mockAnnictTokenRemove(),
  },
}));

jest.mock("@/lib/meishi/storage", () => ({
  loadMeishiDocument: () => mockLoadMeishiDocument(),
  clearMeishiDocument: () => mockClearMeishiDocument(),
}));

const SUMMARY_DATA = {
  watchHistories: 12,
  favorites: 3,
  friends: 2,
  tierLists: 1,
  workLists: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
  loggedInUser();
  mockCanGoBack = true;
  mockDeleteAccount.mockResolvedValue(null);
  mockSummary = {
    data: SUMMARY_DATA,
    isLoading: false,
    isError: false,
    refetch: mockRefetchSummary,
  };
});

// 理由入力 → 件数表示 → 最終確認まで既定のルートを通るヘルパー。
async function advanceToConfirm() {
  await fireEvent.press(screen.getByLabelText("スキップ"));
  await fireEvent.press(screen.getByLabelText("次へ"));
  await screen.findByText("最終確認");
}

describe("DeleteAccountScreen", () => {
  it("スキップ→件数表示→最終確認→削除で後片付けしてサインアウトする", async () => {
    const auth = loggedInUser();
    await render(<DeleteAccountScreen />);

    // 理由ステップ（任意）をスキップ → 件数表示へ
    expect(
      screen.getByText("よろしければ、退会の理由を教えてください"),
    ).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("スキップ"));

    // 件数が表示される
    await screen.findByText("削除されるデータ");
    expect(screen.getByText("12 件")).toBeTruthy();

    // 最終確認へ進み、削除ボタンを押す
    await fireEvent.press(screen.getByLabelText("次へ"));
    await screen.findByText("最終確認");
    await fireEvent.press(screen.getByLabelText("削除する"));

    await waitFor(() => {
      expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    });
    // スキップ経路では理由は送信しない
    expect(mockMutateFeedback).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(mockAnnictTokenRemove).toHaveBeenCalledTimes(1);
      expect(mockClearMeishiDocument).toHaveBeenCalledTimes(1);
      expect(auth.signOut).toHaveBeenCalledTimes(1);
    });
    expect(mockAlert).not.toHaveBeenCalled();
    // runDelete はボタンから detached で走る。末尾のマイクロタスクが
    // 次テストの act に漏れると overlapping act() で壊れるため流し切る。
    await act(async () => {});
  });

  it("理由を選んで次へ進むとフィードバックが送信される", async () => {
    await render(<DeleteAccountScreen />);

    await fireEvent.press(screen.getByLabelText("使い方が分からない"));
    await fireEvent.press(screen.getByLabelText("通知が多い"));
    await fireEvent.changeText(
      screen.getByLabelText("その他の理由を入力"),
      "UI が分かりづらかった",
    );
    await fireEvent.press(screen.getByLabelText("次へ"));

    expect(mockMutateFeedback).toHaveBeenCalledWith(
      {
        reasons: expect.arrayContaining([
          "hard_to_use",
          "too_many_notifications",
        ]),
        freeText: "UI が分かりづらかった",
      },
      expect.anything(),
    );
    await screen.findByText("削除されるデータ");
  });

  it("理由なしで次へ進んでもフィードバックは送らない", async () => {
    await render(<DeleteAccountScreen />);

    await fireEvent.press(screen.getByLabelText("次へ"));

    expect(mockMutateFeedback).not.toHaveBeenCalled();
    await screen.findByText("削除されるデータ");
  });

  it("名刺ドキュメントがあると件数表示に名刺が含まれる", async () => {
    // 「1 件」が名刺だけに出るようサーバ側の件数はゼロにする
    mockSummary = {
      data: {
        watchHistories: 0,
        favorites: 0,
        friends: 0,
        tierLists: 0,
        workLists: 0,
      },
      isLoading: false,
      isError: false,
      refetch: mockRefetchSummary,
    };
    // 件数に出るかだけを見るので、真偽が分かる最小形でよい
    mockLoadMeishiDocument.mockResolvedValueOnce({
      version: 1,
      canvas: { aspectRatio: 1, background: { kind: "solid", color: "#fff" } },
      elements: [],
    });

    await render(<DeleteAccountScreen />);
    await fireEvent.press(screen.getByLabelText("スキップ"));

    await screen.findByText("名刺");
    expect(screen.getByText("1 件")).toBeTruthy();
  });

  it("件数取得に失敗したらエラーと再試行を出す", async () => {
    mockSummary = {
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetchSummary,
    };

    await render(<DeleteAccountScreen />);
    await fireEvent.press(screen.getByLabelText("スキップ"));

    await screen.findByText("削除対象データの取得に失敗しました");
    await fireEvent.press(screen.getByLabelText("削除対象データを再取得"));
    expect(mockRefetchSummary).toHaveBeenCalledTimes(1);
  });

  it("削除 API が失敗したらダイアログで伝えサインアウトしない", async () => {
    mockDeleteAccount.mockRejectedValueOnce(
      new Error("アカウントの削除に失敗しました"),
    );
    await render(<DeleteAccountScreen />);
    await advanceToConfirm();

    await fireEvent.press(screen.getByLabelText("削除する"));

    await waitFor(() => {
      expect(mockAlert).toHaveBeenCalledWith(
        "削除に失敗しました",
        "アカウントの削除に失敗しました",
        { okLabel: "OK" },
      );
    });
    expect(mockAnnictTokenRemove).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it("フロー内では戻るボタンが前のステップに戻り、先頭ではプロフィールに戻る", async () => {
    await render(<DeleteAccountScreen />);

    // summary へ進んでから戻るボタンで reason に戻る
    await fireEvent.press(screen.getByLabelText("スキップ"));
    await screen.findByText("削除されるデータ");
    await fireEvent.press(screen.getByTestId("delete-account-back-button"));
    await screen.findByText("よろしければ、退会の理由を教えてください");

    // 先頭で戻ると router.back へ
    await fireEvent.press(screen.getByTestId("delete-account-back-button"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
