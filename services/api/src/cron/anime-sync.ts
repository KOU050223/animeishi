import { createDb } from "@/db/client";
import { animeSyncRepo } from "@/repository/animeSyncRepo";
import type { AnimeSyncResult } from "@/repository/animeSyncRepo";
import { purgeAnimeCaches } from "./cache";
import type { CachePurgeEnv, CachePurgeResult } from "./cache";
import { fetchFromShobocal } from "./source";
import type { AnimeSource } from "./source";

/** anime-sync バッチが必要とするバインディング。 */
export type AnimeSyncBindings = CachePurgeEnv & {
  DB: D1Database;
};

export type AnimeSyncBatchResult = {
  fetched: number;
  sync: AnimeSyncResult;
  purge: CachePurgeResult;
};

/**
 * アニメデータ全体の同期バッチ。
 * 外部ソースから取得 → D1 へ upsert → 変更があれば Cache Purge、の順で実行する。
 *
 * @param env DB / Cache Purge 用バインディング
 * @param source 取得元（テストではモックを注入。省略時はしょぼいカレンダー）
 */
export async function runAnimeSync(
  env: AnimeSyncBindings,
  source: AnimeSource = fetchFromShobocal,
): Promise<AnimeSyncBatchResult> {
  const inputs = await source();

  const db = createDb(env.DB);
  const repo = animeSyncRepo(db);
  const sync = await repo.syncAnimeTitles(inputs);

  // 1 件も増減・更新が無ければキャッシュは有効なままなのでパージしない。
  const changed = sync.inserted > 0 || sync.updated > 0;
  const purge = changed
    ? await purgeAnimeCaches(env)
    : { zonePurged: false, edgeCachePurged: false };

  return { fetched: inputs.length, sync, purge };
}
