// 名刺帳の相手詳細の「お礼」セクション（issue #694）のテスト。
// 届いた・送ったお礼の表示、開いたときの既読化、送信シートの起動、
// 1 日 1 通のガードを確認する。
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { FriendThanksSection } from "@/components/social/FriendThanksSection";

const mockSendMutate = jest.fn();
const mockDeleteMutateAsync = jest.fn();
const mockMarkReadMutate = jest.fn();
const mockAlert = jest.fn();
const mockConfirm = jest.fn(
  (
    _title: string,
    _message: string,
    onConfirm: () => void,
    _options?: unknown,
  ) => onConfirm(),
);

type ThanksItem = {
  id: number;
  userId: string;
  username: string;
  profileImageUrl: string | null;
  presetKey: string;
  body: string | null;
  createdAt: string;
  readAt?: string | null;
};

let mockReceived: ThanksItem[] = [];
let mockSent: ThanksItem[] = [];
let mockIsError = false;

jest.mock("@/features/friend-thanks/useFriendThanks", () => ({
  useFriendThanksFor: () => ({
    received: mockReceived,
    sent: mockSent,
    isError: mockIsError,
  }),
  useSendFriendThanks: () => ({
    mutate: (...args: unknown[]) => mockSendMutate(...args),
    isPending: false,
  }),
  useDeleteFriendThanks: () => ({
    mutateAsync: (...args: unknown[]) => mockDeleteMutateAsync(...args),
  }),
  useMarkFriendThanksRead: () => ({
    mutate: (...args: unknown[]) => mockMarkReadMutate(...args),
  }),
  THANKS_PRESET_TEXT: {
    thanks_for_card: "名刺ありがとうございました！",
    enjoyed_talking: "お話しできて楽しかったです",
    see_you_again: "また会いましょう",
    recommendations: "今度おすすめ教えてください",
  },
  THANKS_PRESET_KEYS: [
    "thanks_for_card",
    "enjoyed_talking",
    "see_you_again",
    "recommendations",
  ],
  FRIEND_THANKS_BODY_MAX_LENGTH: 60,
}));

jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: unknown,
  ) => mockConfirm(title, message, onConfirm, options),
}));

const receivedItem: ThanksItem = {
  id: 1,
  userId: "friend_1",
  username: "友達A",
  profileImageUrl: null,
  presetKey: "thanks_for_card",
  body: "また会いましょうね",
  createdAt: "2026-11-20T12:00:00.000Z",
  readAt: null,
};

const sentItem: ThanksItem = {
  id: 2,
  userId: "friend_1",
  username: "友達A",
  profileImageUrl: null,
  presetKey: "enjoyed_talking",
  body: null,
  createdAt: "2026-11-19T12:00:00.000Z",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockReceived = [];
  mockSent = [];
  mockIsError = false;
  mockDeleteMutateAsync.mockResolvedValue(undefined);
});

describe("FriendThanksSection", () => {
  it("その相手から届いたお礼と送ったお礼を表示する", async () => {
    mockReceived = [{ ...receivedItem, readAt: "2026-11-20T13:00:00.000Z" }];
    mockSent = [sentItem];
    await render(<FriendThanksSection uid="friend_1" />);

    // 定型文はキーではなく表示文言で出る
    expect(screen.getAllByText("名刺ありがとうございました！")).toBeTruthy();
    expect(screen.getByText("また会いましょうね")).toBeTruthy();
    expect(screen.getAllByText("お話しできて楽しかったです")).toBeTruthy();
    // 受け手側にだけ届いた/送ったの区別が出る
    expect(screen.getByText(/^届いたお礼/)).toBeTruthy();
    expect(screen.getByText(/^送ったお礼/)).toBeTruthy();
  });

  it("その相手からの未読があると開いた時点で既読にする", async () => {
    mockReceived = [receivedItem];
    await render(<FriendThanksSection uid="friend_1" />);

    await waitFor(() =>
      expect(mockMarkReadMutate).toHaveBeenCalledWith("friend_1"),
    );
  });

  it("既読済みだけなら既読化を呼ばない", async () => {
    mockReceived = [{ ...receivedItem, readAt: "2026-11-20T13:00:00.000Z" }];
    await render(<FriendThanksSection uid="friend_1" />);

    expect(mockMarkReadMutate).not.toHaveBeenCalled();
  });

  it("「お礼を送る」でシートを開き、定型文と 1 行で送信する", async () => {
    await render(<FriendThanksSection uid="friend_1" />);

    await fireEvent.press(screen.getByTestId("send-thanks-button"));
    await fireEvent.press(screen.getByTestId("thanks-preset-recommendations"));
    await fireEvent.press(screen.getByTestId("thanks-send-button"));

    expect(mockSendMutate).toHaveBeenCalledWith(
      { friendId: "friend_1", presetKey: "recommendations", body: null },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("日本時間で今日すでに送っているとボタンが「今日はもう送っています」で無効になる", async () => {
    // いまの JST 暦日内の createdAt にすると当日扱いになる。
    mockSent = [{ ...sentItem, createdAt: new Date().toISOString() }];
    await render(<FriendThanksSection uid="friend_1" />);

    const button = screen.getByTestId("send-thanks-button");
    expect(screen.getByText("今日はもう送っています")).toBeTruthy();
    expect(button.props.accessibilityState?.disabled ?? false).toBe(true);
  });

  it("送ったお礼は取り消せる（送り手本人の操作）", async () => {
    mockSent = [sentItem];
    await render(<FriendThanksSection uid="friend_1" />);

    await fireEvent.press(screen.getByLabelText("お礼を取り消す"));

    expect(mockConfirm).toHaveBeenCalled();
    expect(mockDeleteMutateAsync).toHaveBeenCalledWith(2);
  });

  it("取得に失敗したらエラー表示にして送受信一覧は出さない", async () => {
    mockIsError = true;
    mockReceived = [receivedItem];
    await render(<FriendThanksSection uid="friend_1" />);

    expect(screen.getByText("お礼の取得に失敗しました")).toBeTruthy();
    expect(screen.queryByText("名刺ありがとうございました！")).toBeNull();
  });
});
