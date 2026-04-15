import { describe, it, expect } from "vitest";
import { getAuthError, getQRError, getAnimeListError, getProfileError } from "../src/errors.js";

describe("getAuthError", () => {
  it("既知のコードで正しいメッセージを返す", () => {
    expect(getAuthError("user-not-found")).toBe(
      "このメールアドレスのアカウントは存在しません"
    );
    expect(getAuthError("wrong-password")).toBe("パスワードが間違っています");
    expect(getAuthError("email-already-in-use")).toBe(
      "このメールアドレスは既に使用されています"
    );
    expect(getAuthError("too-many-requests")).toBe(
      "ログイン試行回数が上限に達しました。しばらくしてから再試行してください"
    );
    expect(getAuthError("network-request-failed")).toBe(
      "ネットワーク接続を確認してください"
    );
  });

  it("未知のコードはデフォルトメッセージを返す", () => {
    expect(getAuthError("unknown-code")).toBe(
      "認証エラーが発生しました。しばらくしてから再試行してください"
    );
  });
});

describe("getQRError", () => {
  it("既知のコードで正しいメッセージを返す", () => {
    expect(getQRError("invalid_format")).toBe("無効なQRコードです");
    expect(getQRError("self_scan")).toBe("自分のQRコードはスキャンできません");
    expect(getQRError("user_not_found")).toBe("このユーザーは存在しません");
    expect(getQRError("already_friend")).toBe("既にフレンドです");
    expect(getQRError("camera_permission")).toBe("カメラの使用許可が必要です");
  });

  it("未知のコードはデフォルトメッセージを返す", () => {
    expect(getQRError("unknown")).toBe("QRコードの処理中にエラーが発生しました");
  });
});

describe("getAnimeListError", () => {
  it("既知のコードで正しいメッセージを返す", () => {
    expect(getAnimeListError("fetch_failed")).toBe(
      "アニメリストの取得に失敗しました"
    );
    expect(getAnimeListError("save_failed")).toBe("アニメの保存に失敗しました");
    expect(getAnimeListError("delete_failed")).toBe("アニメの削除に失敗しました");
    expect(getAnimeListError("empty_selection")).toBe(
      "アニメが選択されていません"
    );
  });

  it("未知のコードはデフォルトメッセージを返す", () => {
    expect(getAnimeListError("unknown")).toBe(
      "アニメリストの処理中にエラーが発生しました"
    );
  });
});

describe("getProfileError", () => {
  it("既知のコードで正しいメッセージを返す", () => {
    expect(getProfileError("update_failed")).toBe(
      "プロフィールの更新に失敗しました"
    );
    expect(getProfileError("invalid_username")).toBe("ユーザー名が無効です");
    expect(getProfileError("username_too_long")).toBe(
      "ユーザー名が長すぎます（20文字以内で入力してください）"
    );
  });

  it("未知のコードはデフォルトメッセージを返す", () => {
    expect(getProfileError("unknown")).toBe(
      "プロフィールの処理中にエラーが発生しました"
    );
  });
});
