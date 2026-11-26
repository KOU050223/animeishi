import type { TFunction } from "i18next";

/** サインインが complete にならなかったときに、ステータスから出す文言。 */
export function getIncompleteSignInMessage(
  status: string | null,
  t: TFunction,
) {
  if (!status) {
    return t("サインインを完了できませんでした。もう一度お試しください。");
  }

  if (status === "needs_second_factor") {
    return t("二要素認証が必要ですが、この画面ではまだ対応していません。");
  }

  if (status === "needs_identifier" || status === "needs_first_factor") {
    return t("メールアドレスまたはパスワードを確認してください。");
  }

  return t("サインインを完了できませんでした。状態: {{status}}", { status });
}
