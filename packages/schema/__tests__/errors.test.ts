import { describe, it, expect } from "vitest";
import {
  getAuthError,
  getQRError,
  getAnimeListError,
  getProfileError,
} from "../src/errors";

describe("getAuthError", () => {
  it("既知のエラーコードに対してメッセージを返す", () => {
    expect(getAuthError("user-not-found")).toBe("このメールアドレスのアカウントは存在しません");
    expect(getAuthError("wrong-password")).toBe("パスワードが間違っています");
    expect(getAuthError("email-already-in-use")).toBe("このメールアドレスは既に使用されています");
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
