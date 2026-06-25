import { runAnimeSync } from "./anime-sync";
import type { AnimeSyncBindings } from "./anime-sync";
import { runSeasonSync } from "./season-sync";
import type { SeasonSyncBindings } from "./season-sync";

/** scheduled ハンドラのバインディング（全バッチ分の和）。 */
export type CronBindings = AnimeSyncBindings & SeasonSyncBindings;

// cron 式ごとに実行するバッチ。wrangler.toml の [triggers] crons と対応させる。
//   - 毎日 18:00 UTC（= JST 翌 3:00）に全件同期
//   - 6 時間ごとに現在シーズンを同期
export const ANIME_SYNC_CRON = "0 18 * * *";
export const SEASON_SYNC_CRON = "0 */6 * * *";

/**
 * Cloudflare Workers の scheduled ハンドラ本体。
 * cron 式に応じて対応するバッチを実行する。
 * 未知の cron 式が来た場合は安全側に倒して全件同期を実行する。
 */
export async function handleScheduled(
  event: { cron: string },
  env: CronBindings,
): Promise<void> {
  switch (event.cron) {
    case SEASON_SYNC_CRON: {
      const result = await runSeasonSync(env);
      console.log("[cron] season-sync 完了", result);
      return;
    }
    case ANIME_SYNC_CRON:
    default: {
      const result = await runAnimeSync(env);
      console.log("[cron] anime-sync 完了", result);
      return;
    }
  }
}
