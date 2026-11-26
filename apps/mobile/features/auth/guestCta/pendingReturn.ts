// 未ログインで公開プロフィールの CTA を押した人を、登録（とオンボーディング）
// の後に元のプロフィールへ戻すための記録（issue #562）。
// 保存・読み出しの判定だけを持ち、ストレージには依存しない。

/** 登録後に戻す記録の有効期間。メール認証とオンボーディングを挟んでも足りる長さ。 */
export const PENDING_RETURN_TTL_MS = 60 * 60 * 1000;

// 戻り先は公開プロフィールだけに絞る。任意パスを許すと、ストレージを
// 書き換えられたときに登録直後の遷移先を差し替えられる。
const RETURNABLE_PATH = /^\/user\/[A-Za-z0-9_-]+$/;

export function isReturnablePath(path: string): boolean {
  return RETURNABLE_PATH.test(path);
}

export function profileReturnPath(uid: string): string | null {
  const path = `/user/${uid}`;
  return isReturnablePath(path) ? path : null;
}

type PendingReturnRecord = { path: string; savedAt: number };

export function serializePendingReturn(path: string, now: number): string {
  const record: PendingReturnRecord = { path, savedAt: now };
  return JSON.stringify(record);
}

/** 保存値から戻り先を取り出す。壊れた値・期限切れ・許可外のパスは null。 */
export function parsePendingReturn(
  raw: string | null,
  now: number,
): string | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { path, savedAt } = parsed as Partial<PendingReturnRecord>;
  if (typeof path !== "string" || typeof savedAt !== "number") return null;
  if (!isReturnablePath(path)) return null;
  if (now - savedAt < 0 || now - savedAt > PENDING_RETURN_TTL_MS) return null;
  return path;
}
