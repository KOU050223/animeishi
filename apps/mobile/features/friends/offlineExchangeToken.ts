import AsyncStorage from "@react-native-async-storage/async-storage";

// オフライン交換トークン（ot）の端末キャッシュ（issue #680、設計
// docs/13_offline-exchange-design.md）。
// GET /me/friends/qr-token が qt と一緒に返す ot（24 時間）をオンラインの
// うちに保存しておき、オフラインで qt を取れないとき QR の `?ot=` として
// フォールバック表示する。
const STORAGE_KEY = "offlineExchangeToken:v1";

type StoredOfflineExchangeToken = {
  userId: string;
  token: string;
  /** UNIX 秒。 */
  expiresAt: number;
};

/** 取得した ot を保存する。取得ごとに新しいトークンで上書きする。 */
export async function saveOfflineExchangeToken(
  stored: StoredOfflineExchangeToken,
): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // 保存に失敗してもオンライン時の交換には影響しない（フォールバックが
    // 効かなくなるだけ）。
  }
}

/**
 * userId に紐づく期限内の ot を返す。無い・期限切れ・他人のものは null。
 * userId を照合するのは、端末のサインインが別ユーザーに切り替わったとき
 * 前ユーザーのトークンを QR に載せないため。
 */
export async function readOfflineExchangeToken(
  userId: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Partial<StoredOfflineExchangeToken>;
    if (
      typeof stored.token !== "string" ||
      stored.userId !== userId ||
      typeof stored.expiresAt !== "number" ||
      stored.expiresAt <= nowSec
    ) {
      return null;
    }
    return stored.token;
  } catch {
    return null;
  }
}
