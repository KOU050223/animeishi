import AsyncStorage from "@react-native-async-storage/async-storage";
import { emptyLibrary, migrateLegacyDocument } from "./library";
import type { MeishiDocument, MeishiLibrary } from "./types";

// マルチ名刺（issue #427）の保存先。cards + defaultCardId を持つ。
const LIBRARY_KEY = "meishi-library:v1";
// 単一名刺時代の保存先。初回読み込み時にライブラリへ移行するため
// 読み出しだけ残す（書き込みは saveMeishiLibrary 側で消す）。
const LEGACY_KEY = "meishi-document:v1";

// レガシー移行で作るカードの ID。移行の書き込みに失敗しても
// 次の読み込みで別 ID にならないよう、ランダムではなく固定にする。
const LEGACY_MIGRATED_CARD_ID = "card-legacy";

// ライブラリの読み書きを直列化するキュー。一覧とエディタは別フックで
// 同じ保存先を read-modify-write するため、キューを介さないと
// 連続操作やフック間の競合で保存が巻き戻る。
let meishiQueue: Promise<unknown> = Promise.resolve();

function enqueueMeishiJob<T>(job: () => Promise<T>): Promise<T> {
  const run = meishiQueue.then(job, job);
  meishiQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

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
export function clearMeishiDocument(): Promise<void> {
  return enqueueMeishiJob(async () => {
    try {
      await AsyncStorage.multiRemove([LEGACY_KEY, LIBRARY_KEY]);
    } catch {}
  });
}

/**
 * 名刺ライブラリを読み出す。
 * ライブラリが無く従来の単一ドキュメントだけあるときは既定カードとして
 * 移行し、その場で書き込んで確定させる。確定しないと読み込みごとに
 * 別 ID のカードが生成され、一覧で選んだ名刺をエディタが見つけられない。
 */
export function loadMeishiLibrary(): Promise<MeishiLibrary | null> {
  return enqueueMeishiJob(loadMeishiLibraryUnlocked);
}

async function loadMeishiLibraryUnlocked(): Promise<MeishiLibrary | null> {
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
  const migrated = migrateLegacyDocument(legacy, {
    id: LEGACY_MIGRATED_CARD_ID,
  });
  // 書き込み成功を待ってから返す。save 内でライブラリを書いてから
  // レガシーを消すので、失敗時もレガシーが残り次回再移行できる。
  await saveMeishiLibraryUnlocked(migrated);
  return migrated;
}

export function saveMeishiLibrary(library: MeishiLibrary): Promise<void> {
  return enqueueMeishiJob(() => saveMeishiLibraryUnlocked(library));
}

async function saveMeishiLibraryUnlocked(
  library: MeishiLibrary,
): Promise<void> {
  try {
    await AsyncStorage.multiSet([[LIBRARY_KEY, JSON.stringify(library)]]);
    // ライブラリが正の保存先になった時点でレガシーを消す。
    // 残すと loadMeishiLibrary の移行が古い内容を復活させうるため。
    await AsyncStorage.removeItem(LEGACY_KEY);
  } catch {
    // 保存失敗は握りつぶす（次回保存時にリトライされる）
  }
}

export type MeishiLibraryUpdate<T> = {
  library: MeishiLibrary;
  result: T;
};

// 最新の保存状態を読んで updater を適用し、結果を書き戻す。
// 呼び出しはキューで直列化されるので、await しない連続操作でも
// 先の操作の結果を失わない。一覧・エディタどちらの変更もここを通す。
export function updateMeishiLibrary<T>(
  updater: (library: MeishiLibrary) => MeishiLibraryUpdate<T>,
): Promise<MeishiLibraryUpdate<T>> {
  return enqueueMeishiJob(async () => {
    const current = (await loadMeishiLibraryUnlocked()) ?? emptyLibrary();
    const out = updater(current);
    await saveMeishiLibraryUnlocked(out.library);
    return out;
  });
}
