import { Alert } from "react-native";
import {
  alert as alertNative,
  confirm as confirmNative,
} from "@/lib/dialog/dialog.native";
import {
  alert as alertWeb,
  confirm as confirmWeb,
} from "@/lib/dialog/dialog.web";

describe("dialog.native", () => {
  beforeEach(() => {
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("alert は呼び出し側が渡したラベルのボタンで Alert.alert を呼ぶ", () => {
    const onClose = jest.fn();
    alertNative("タイトル", "本文", { okLabel: "閉じる", onClose });

    expect(Alert.alert).toHaveBeenCalledWith("タイトル", "本文", [
      { text: "閉じる", onPress: onClose },
    ]);
  });

  it("confirm は承諾ボタンの onPress で onConfirm を呼ぶ", () => {
    const onConfirm = jest.fn();
    confirmNative("削除確認", "削除しますか？", onConfirm, {
      confirmLabel: "削除",
      cancelLabel: "キャンセル",
      destructive: true,
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    expect(buttons[0]).toMatchObject({ text: "キャンセル", style: "cancel" });
    expect(buttons[1]).toMatchObject({ text: "削除", style: "destructive" });

    // 承諾ボタンを押すと onConfirm が発火する。
    buttons[1].onPress();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("confirm は呼び出し側が渡したラベルをそのまま使う", () => {
    confirmNative("確認", "よろしいですか？", jest.fn(), {
      confirmLabel: "OK",
      cancelLabel: "やめる",
    });

    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
    expect(buttons[0].text).toBe("やめる");
    expect(buttons[1].text).toBe("OK");
    // destructive 未指定なら通常スタイル。
    expect(buttons[1].style).toBe("default");
  });
});

describe("dialog.web", () => {
  // jest-expo の native 環境には window.alert/confirm が無いため、
  // テスト中だけプロパティを差し込む。
  const original = {
    alert: window.alert,
    confirm: window.confirm,
  };

  afterEach(() => {
    window.alert = original.alert;
    window.confirm = original.confirm;
  });

  it("alert は window.alert を呼び onClose を実行する", () => {
    const alertMock = jest.fn();
    window.alert = alertMock;
    const onClose = jest.fn();

    alertWeb("タイトル", "本文", { okLabel: "OK", onClose });

    expect(alertMock).toHaveBeenCalledWith("タイトル\n本文");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("confirm は承諾時のみ onConfirm を呼ぶ", () => {
    window.confirm = jest.fn(() => true);
    const onConfirm = jest.fn();

    confirmWeb("削除", "削除しますか？", onConfirm, {
      confirmLabel: "削除",
      cancelLabel: "キャンセル",
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("confirm はキャンセル時は onConfirm を呼ばない", () => {
    window.confirm = jest.fn(() => false);
    const onConfirm = jest.fn();

    confirmWeb("削除", "削除しますか？", onConfirm, {
      confirmLabel: "削除",
      cancelLabel: "キャンセル",
    });

    expect(onConfirm).not.toHaveBeenCalled();
  });
});
