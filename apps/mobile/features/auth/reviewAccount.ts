import { apiClient } from "@/lib/api";

// App Store 審査・Expo Explore 用のデモアカウント。Clerk の Device Trust が
// 新しい端末でメールコードを求めても、デモアカウントだけは API が発行する
// sign-in token（ticket）でサインインさせる（apps/api/src/features/demo-sign-in）。
// 一般ユーザーのパスワードを API に送らないよう、このアドレスと一致したときだけ問い合わせる。

/** 入力されたメールアドレスがデモアカウントのものか。未設定の環境では常に false。 */
export function isReviewAccountEmail(
  email: string,
  configured: string | undefined = process.env.EXPO_PUBLIC_REVIEW_ACCOUNT_EMAIL,
): boolean {
  const expected = configured?.trim().toLowerCase();
  if (!expected) return false;
  return email.trim().toLowerCase() === expected;
}

class DemoSignInRejectedError extends Error {
  constructor(readonly status: number) {
    super(`demo sign-in rejected: ${status}`);
    this.name = "DemoSignInRejectedError";
  }
}

/** デモアカウントのパスワードを API で照合し、Clerk の sign-in token を受け取る。 */
export async function requestDemoSignInTicket(
  email: string,
  password: string,
): Promise<string> {
  const res = await apiClient.auth["demo-sign-in"].$post({
    json: { email, password },
  });
  if (!res.ok) throw new DemoSignInRejectedError(res.status);
  const { ticket } = await res.json();
  return ticket;
}
