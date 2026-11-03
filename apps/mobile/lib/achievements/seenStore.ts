import AsyncStorage from "@react-native-async-storage/async-storage";

// 「お祝い表示済み」の実績キーを端末ローカルに持つ（issue #415）。
// サーバー側は獲得履歴を持たず都度計算だけ返すため、「新しく獲得した」
// 判定は前回確認時点との差分で行う。キーはログインユーザーごとに分離する。
const storageKey = (userId: string) => `achievements:seen:v1:${userId}`;

/**
 * 既に確認済みの実績キー集合。
 * 一度も保存していない（機能追加前からのユーザー含む初回起動）は null を返し、
 * 呼び出し側は差分を取らずベースラインとして保存する
 * （いきなり全獲得済みバッジのお祝いが連続表示されるのを防ぐため）。
 */
export async function loadSeenAchievementKeys(
  userId: string,
): Promise<Set<string> | null> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === "string"));
  } catch {
    return null;
  }
}

export async function saveSeenAchievementKeys(
  userId: string,
  keys: Iterable<string>,
): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify([...keys]));
  } catch {}
}
