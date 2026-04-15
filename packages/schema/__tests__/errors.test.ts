import { describe, it, expect } from "vitest";
import {
  getAuthError,
  getQRError,
  getAnimeListError,
  getProfileError,
} from "../src/errors";

describe("getAuthError", () => {
  it("サインイン系エラーコードに対してメッセージを返す", () => {
    expect(getAuthError("form_identifier_not_found")).toBe("このメールアドレスのアカウントは存在しません");
    expect(getAuthError("form_password_incorrect")).toBe("パスワードが間違っています");
    expect(getAuthError("user_locked")).toContain("上限に達しました");
    expect(getAuthError("form_password_compromised")).toContain("安全でない");
  });

  it("サインアップ系エラーコードに対してメッセージを返す", () => {
    expect(getAuthError("form_email_conflict")).toBe("このメールアドレスは既に使用されています");
    expect(getAuthError("form_invalid_email_address")).toContain("メールアドレス");
    expect(getAuthError("form_password_not_strong_enough")).toContain("弱すぎます");
    expect(getAuthError("form_invalid_password_length_too_short")).toContain("8文字以上");
  });

  it("セッション系エラーコードに対してメッセージを返す", () => {
    expect(getAuthError("session_reverification_required")).toContain("再ログイン");
    expect(getAuthError("authentication_invalid")).toContain("再度ログイン");
  });

  it("不明なコードにデフォルトメッセージを返す", () => {
    expect(getAuthError("unknown-error-code")).toContain("再試行してください");
  });
});

describe("getQRError", () => {
  it("既知のエラーコードに対してメッセージを返す", () => {
    expect(getQRError("self_scan")).toBe("自分のQRコードはスキャンできません");
    expect(getQRError("already_friend")).toBe("既にフレンドです");
    expect(getQRError("camera_permission")).toBe("カメラの使用許可が必要です");
  });

  it("不明なコードにデフォルトメッセージを返す", () => {
    expect(getQRError("unknown")).toContain("エラーが発生しました");
  });
});

describe("getAnimeListError", () => {
  it("既知のエラーコードに対してメッセージを返す", () => {
    expect(getAnimeListError("fetch_failed")).toBe("アニメリストの取得に失敗しました");
    expect(getAnimeListError("save_failed")).toBe("アニメの保存に失敗しました");
  });

  it("不明なコードにデフォルトメッセージを返す", () => {
    expect(getAnimeListError("unknown")).toContain("エラーが発生しました");
  });
});

describe("getProfileError", () => {
  it("既知のエラーコードに対してメッセージを返す", () => {
    expect(getProfileError("update_failed")).toBe("プロフィールの更新に失敗しました");
    expect(getProfileError("invalid_username")).toBe("ユーザー名が無効です");
  });

  it("不明なコードにデフォルトメッセージを返す", () => {
    expect(getProfileError("unknown")).toContain("エラーが発生しました");
  });
});
