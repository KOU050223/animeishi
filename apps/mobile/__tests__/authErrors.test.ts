import { toAuthErrorMessage } from "@/lib/authErrors";

describe("toAuthErrorMessage", () => {
  it("既知の Clerk エラーコードを日本語へ変換する", () => {
    const err = {
      errors: [
        { code: "form_password_incorrect", message: "Password is incorrect." },
      ],
    };
    expect(toAuthErrorMessage(err)).toBe(
      "メールアドレスまたはパスワードが違います",
    );
  });

  it("メールアドレス重複のエラーを変換する", () => {
    const err = {
      errors: [{ code: "form_identifier_exists", message: "exists" }],
    };
    expect(toAuthErrorMessage(err)).toBe(
      "このメールアドレスは既に登録されています",
    );
  });

  it("未知のコードの場合はフォールバックキーを翻訳して返す（英語を漏らさない）", () => {
    const err = {
      errors: [
        {
          code: "unknown_internal_error",
          message: "We were unable to complete a GET request...",
        },
      ],
    };
    expect(toAuthErrorMessage(err, "サインインに失敗しました")).toBe(
      "サインインに失敗しました",
    );
  });

  it("errors 配列を持たないエラーはフォールバックキーを翻訳して返す", () => {
    expect(toAuthErrorMessage(new Error("boom"), "サインアップに失敗しました")).toBe(
      "サインアップに失敗しました",
    );
  });

  it("フォールバックキー未指定なら既定のフォールバック文言を返す", () => {
    expect(toAuthErrorMessage(null)).toBe(
      "処理に失敗しました。もう一度お試しください",
    );
  });
});
