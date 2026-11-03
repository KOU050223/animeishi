import AsyncStorage from "@react-native-async-storage/async-storage";
import { migrateLegacyDocument } from "./library";
import type { MeishiDocument, MeishiLibrary } from "./types";

// マルチ名刺（issue #427）の保存先。cards + defaultCardId を持つ。
const LIBRARY_KEY = "meishi-library:v1";
// 単一名刺時代の保存先。初回読み込み時にライブラリへ移行するため
// 読み出しだけ残す（書き込みは saveMeishiLibrary 側で消す）。
const LEGACY_KEY = "meishi-document:v1";

export async function loadMeishiDocument(): Promise<MeishiDocument | null> {
  try {
    const raw = await AsyncStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      return null;
    }
    return parsed as MeishiDocument;
  } catch {
    return null;
  }
}

// 名刺データをすべて消す（退会時の端末データ掃除用）。
export async function clearMeishiDocument(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([LEGACY_KEY, LIBRARY_KEY]);
  } catch {}
}

/**
 * 名刺ライブラリを読み出す。
 * ライブラリが無く従来の単一ドキュメントだけあるときは、その場で
 * 既定カードとして移行した形で返す（既存ユーザーの名刺を消さない）。
 * 移行結果の確定（書き込み + レガシー削除）は次の saveMeishiLibrary で行う。
 */
export async function loadMeishiLibrary(): Promise<MeishiLibrary | null> {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && parsed.version === 1) {
        return parsed as MeishiLibrary;
      }
      return null;
    }
  } catch {
    return null;
  }

  const legacy = await loadMeishiDocument();
  if (!legacy) return null;
  return migrateLegacyDocument(legacy);
}

export async function saveMeishiLibrary(library: MeishiLibrary): Promise<void> {
  try {
    await AsyncStorage.multiSet([[LIBRARY_KEY, JSON.stringify(library)]]);
    // ライブラリが正の保存先になった時点でレガシーを消す。
    // 残すと loadMeishiLibrary の移行が古い内容を復活させうるため。
    await AsyncStorage.removeItem(LEGACY_KEY);
  } catch {
    // 保存失敗は握りつぶす（次回保存時にリトライされる）
  }
}
