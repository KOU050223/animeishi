// 名刺帳の私用メモ（issue #659）のテスト。メモの表示・編集シートの開閉・
// 保存（空なら削除）・失敗時のダイアログを確認する。
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { FriendNoteSection } from "@/features/friends/components/FriendNoteSection";

let mockNoteData:
  | { body: string | null; updatedAt: string | null }
  | undefined = { body: null, updatedAt: null };
const mockMutate = jest.fn();
const mockAlert = jest.fn();

jest.mock("@/features/friends/useFriendNote", () => ({
  useFriendNote: () => ({ data: mockNoteData }),
  useSaveFriendNote: () => ({
    mutate: (input: unknown, options?: unknown) => mockMutate(input, options),
    isPending: false,
  }),
}));

jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockNoteData = { body: null, updatedAt: null };
});

describe("FriendNoteSection", () => {
  it("自分だけが見えることを説明し、未作成なら「メモを追加」を出す", async () => {
    await render(<FriendNoteSection uid="friend_1" />);

    expect(screen.getByText("自分だけが見えるメモです")).toBeTruthy();
    expect(screen.getByText("メモを追加")).toBeTruthy();
  });

  it("保存済みのメモ本文を表示する", async () => {
    mockNoteData = {
      body: "カフェで会った",
      updatedAt: "2026-11-10T00:00:00Z",
    };
    await render(<FriendNoteSection uid="friend_1" />);

    expect(screen.getByText("カフェで会った")).toBeTruthy();
  });

  it("シートで保存すると入力した本文で保存が呼ばれる", async () => {
    mockNoteData = { body: "既存メモ", updatedAt: "2026-11-10T00:00:00Z" };
    await render(<FriendNoteSection uid="friend_1" />);

    await fireEvent.press(screen.getByText("既存メモ"));
    // シートには既存本文が入った状態で開く
    const input = screen.getByPlaceholderText("この人のことを覚えておくメモ");
    await fireEvent.changeText(input, "更新したメモ");
    await fireEvent.press(screen.getByText("保存"));

    expect(mockMutate).toHaveBeenCalledWith(
      { friendId: "friend_1", body: "更新したメモ" },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("空にして保存すると空文字で保存が呼ばれる（API 側で削除）", async () => {
    mockNoteData = { body: "消すメモ", updatedAt: "2026-11-10T00:00:00Z" };
    await render(<FriendNoteSection uid="friend_1" />);

    await fireEvent.press(screen.getByText("消すメモ"));
    const input = screen.getByPlaceholderText("この人のことを覚えておくメモ");
    await fireEvent.changeText(input, "");
    await fireEvent.press(screen.getByText("保存"));

    expect(mockMutate).toHaveBeenCalledWith(
      { friendId: "friend_1", body: "" },
      expect.anything(),
    );
  });

  it("保存に失敗するとダイアログで通知する", async () => {
    mockMutate.mockImplementation(
      (_input: unknown, options: { onError?: () => void }) =>
        options.onError?.(),
    );
    mockNoteData = { body: "既存メモ", updatedAt: "2026-11-10T00:00:00Z" };
    await render(<FriendNoteSection uid="friend_1" />);

    await fireEvent.press(screen.getByText("既存メモ"));
    await fireEvent.press(screen.getByText("保存"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "メモを保存できませんでした",
        "メモの保存に失敗しました",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });
});
