import AsyncStorage from "@react-native-async-storage/async-storage";
import { parsePendingReturn, serializePendingReturn } from "./pendingReturn";

// 端末ローカルに持つ（Web は localStorage）。Web の Google 登録は
// ページ全体のリダイレクトを挟むため、モジュール状態では戻り先が消える。
const STORAGE_KEY = "guestCta:pendingReturn:v1";

// サインイン中は画面遷移のたびに消費を試みるため、記録が無いと分かった後は
// ストレージを読まない。起動直後は前回のページで保存された可能性があるので true。
let mayHavePending = true;
// 消費中に別の遷移で再度呼ばれても二重に遷移しないようにする。
let consuming: Promise<string | null> | null = null;

export async function savePendingReturn(path: string): Promise<void> {
  mayHavePending = true;
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      serializePendingReturn(path, Date.now()),
    );
  } catch {
    // 保存に失敗しても登録自体は進められる（戻り先がホームになるだけ）。
  }
}

/** 戻り先を取り出して記録を消す。無い・期限切れ・消費中なら null。 */
export function consumePendingReturn(): Promise<string | null> {
  if (!mayHavePending || consuming) return Promise.resolve(null);
  consuming = (async () => {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw !== null) await AsyncStorage.removeItem(STORAGE_KEY);
      // 記録が無い・消し終えたと確認できたときだけ以後の読み出しを省く。
      // 読み書きの失敗時は記録が残っている可能性があるので次の遷移で再試行する。
      mayHavePending = false;
      return parsePendingReturn(raw, Date.now());
    } catch {
      return null;
    } finally {
      consuming = null;
    }
  })();
  return consuming;
}

// テスト用。モジュール状態を起動直後に戻す。
export function resetPendingReturnForTest(): void {
  mayHavePending = true;
  consuming = null;
}
