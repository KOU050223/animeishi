import { createDb } from "@/db/client";
import { animeSyncRepo } from "@/repository/animeSyncRepo";
import type { AnimeSyncResult } from "@/repository/animeSyncRepo";
import { purgeAnimeCaches } from "./cache";
import type { CachePurgeEnv, CachePurgeResult } from "./cache";
import { fetchFromShobocal } from "./source";
import type { AnimeSource } from "./source";

/** season-sync バッチが必要とするバインディング。 */
export type SeasonSyncBindings = CachePurgeEnv & {
  DB: D1Database;
};

export type SeasonSyncBatchResult = {
  year: number;
  season: string;
  fetched: number;
  sync: AnimeSyncResult;
  purge: CachePurgeResult;
};

/** 月（0-11）から季節を導出する。 */
function currentSeason(month: number): string {
  if (month >= 2 && month <= 4) return "spring";
  if (month >= 5 && month <= 7) return "summer";
  if (month >= 8 && month <= 10) return "fall";
  return "winter";
}

/**
 * 現在シーズンのアニメ情報のみを更新する軽量バッチ。
 * anime-sync（全件）より高頻度で回し、放送中作品のメタ情報を最新化する用途。
 *
 * @param env DB / Cache Purge 用バインディング
 * @param source 取得元（テストではモックを注入。省略時はしょぼいカレンダー）
 * @param now 基準時刻（テスト用。省略時は現在時刻）
 */
export async function runSeasonSync(
  env: SeasonSyncBindings,
  source: AnimeSource = fetchFromShobocal,
  now: Date = new Date(),
): Promise<SeasonSyncBatchResult> {
  const year = now.getUTCFullYear();
  const season = currentSeason(now.getUTCMonth());

  const inputs = await source({ year, season });

  const db = createDb(env.DB);
  const repo = animeSyncRepo(db);
  const sync = await repo.syncAnimeTitles(inputs);

  const changed = sync.inserted > 0 || sync.updated > 0;
  const purge = changed
    ? await purgeAnimeCaches(env)
    : { zonePurged: false, edgeCachePurged: false };

  return { year, season, fetched: inputs.length, sync, purge };
}
