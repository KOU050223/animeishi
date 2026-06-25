/**
 * アニメマスターデータの手動同期スクリプト。
 *
 * cron（src/cron/anime-sync.ts）と同じ取得元（しょぼいカレンダー）からデータを取得し、
 * anime_titles への UPSERT 文を生成して標準出力へ書き出す。
 * 生成された SQL は wrangler d1 execute --file で D1 に流す想定（Taskfile.yml の anime-data-sync 参照）。
 *
 * cron はランタイム（Workers）上で drizzle 経由の upsert を行うが、
 * このスクリプトはローカルから本番 D1 を埋め直す運用口として、
 * 同じ取得ロジック（fetchFromShobocal）を共有しつつ SQL 生成に徹する。
 * 重複排除は source_id の UNIQUE 制約 + ON CONFLICT で行うため、何度流しても冪等。
 *
 * Usage:
 *   tsx scripts/sync-anime.ts > /tmp/anime-sync.sql
 */
import { fetchFromShobocal } from "../src/cron/source.ts";

/** SQLite の文字列リテラルとしてエスケープする（シングルクオートを 2 個に）。 */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** null 許容の文字列値を SQL リテラル（NULL or quoted）に変換する。 */
function sqlNullableString(value: string | null | undefined): string {
  return value == null ? "NULL" : sqlString(value);
}

/** null 許容の数値値を SQL リテラル（NULL or number）に変換する。 */
function sqlNullableNumber(value: number | null | undefined): string {
  return value == null ? "NULL" : String(value);
}

async function main() {
  const inputs = await fetchFromShobocal();

  // source_id を持たない入力は UPSERT のコンフリクトキーにできず、
  // 流すたびに重複行が増えるため除外する（cron 側は title フォールバックを持つが、
  // 一括 SQL では安全側に倒して source_id ありのみを対象にする）。
  const rows = inputs.filter((t) => t.sourceId != null);

  const lines: string[] = [];
  lines.push("-- 自動生成: scripts/sync-anime.ts");
  lines.push(`-- 生成時刻: ${new Date().toISOString()}`);
  lines.push(`-- 取得件数: ${inputs.length} / 投入対象(source_idあり): ${rows.length}`);

  for (const t of rows) {
    const values = [
      sqlNullableString(t.sourceId),
      sqlString(t.title),
      sqlNullableString(t.titleReading),
      sqlNullableString(t.titleEnglish),
      sqlNullableNumber(t.year),
      sqlNullableString(t.season),
      t.genres == null ? "NULL" : sqlString(JSON.stringify(t.genres)),
      sqlNullableString(t.thumbnailUrl),
    ].join(", ");

    // source_id の UNIQUE 制約に基づく UPSERT。既存行は内容を上書きし updated_at を更新する。
    // created_at は INSERT 時のみセットされ、UPDATE では維持される。
    lines.push(
      `INSERT INTO anime_titles ` +
        `(source_id, title, title_reading, title_english, year, season, genres, thumbnail_url, created_at, updated_at) ` +
        `VALUES (${values}, unixepoch(), unixepoch()) ` +
        `ON CONFLICT(source_id) DO UPDATE SET ` +
        `title = excluded.title, ` +
        `title_reading = excluded.title_reading, ` +
        `title_english = excluded.title_english, ` +
        `year = excluded.year, ` +
        `season = excluded.season, ` +
        `genres = excluded.genres, ` +
        `thumbnail_url = excluded.thumbnail_url, ` +
        `updated_at = unixepoch();`,
    );
  }

  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
