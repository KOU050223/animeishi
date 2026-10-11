/**
 * session_exists エラー時の既存セッション復旧ユーティリティ。
 *
 * 実機では「Clerk client 上にセッションが残っているのに isSignedIn=false」
 * という状態になり得る（サインアップがセッションだけ作成して失敗した場合等）。
 * その状態で画面遷移だけ行うと AuthGuard に認証画面へ戻されてループするため、
 * client.sessions / lastActiveSessionId から既存セッションを取り出して
 * setActive で活性化してから遷移する。取り出せなければ signOut で
 * 不整合な状態を掃除し、呼び出し側に再試行を促す表示を任せる。
 */

type ClerkClientLike =
  | {
      lastActiveSessionId?: string | null;
      sessions?: ReadonlyArray<{ id: string }>;
      signedInSessions?: ReadonlyArray<{ id: string }>;
    }
  | null
  | undefined;

export type RecoverExistingSessionResult = "activated" | "signed_out";

export async function recoverExistingSession(params: {
  client: ClerkClientLike;
  setActive: (params: { session: string }) => Promise<void>;
  signOut: () => Promise<unknown>;
}): Promise<RecoverExistingSessionResult> {
  const { client, setActive, signOut } = params;

  const sessions = [
    ...(client?.signedInSessions ?? []),
    ...(client?.sessions ?? []),
  ];
  // lastActiveSessionId は失効済みの値を指すことがあるため、
  // client 上に実在するセッションを優先して選ぶ。
  const lastActive = client?.lastActiveSessionId;
  const sessionId =
    (lastActive && sessions.some((s) => s.id === lastActive)
      ? lastActive
      : undefined) ?? sessions[0]?.id;

  if (sessionId) {
    try {
      await setActive({ session: sessionId });
      return "activated";
    } catch {
      // セッションが既に失効している等。後続の signOut で状態を掃除する。
    }
  }

  try {
    await signOut();
  } catch {
    // サインアウト自体の失敗は無視する（目的は状態の掃除であり、
    // 失敗しても呼び出し側は同じ再試行メッセージを出すだけでよい）。
  }
  return "signed_out";
}
