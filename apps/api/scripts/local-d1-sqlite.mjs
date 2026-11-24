// wrangler dev がローカル D1 用に生成する SQLite ファイルを
// database_id から特定するための純関数群。drizzle.config.ts から使う。
import { createHash, createHmac } from "node:crypto";

// miniflare の D1 プラグインが Durable Object namespace に使う uniqueKey。
// ストレージのサブディレクトリ名にもそのまま使われる
// （node_modules/miniflare: D1_DATABASE_OBJECT_CLASS_NAME / uniqueKey）。
export const D1_OBJECT_UNIQUE_KEY = "miniflare-D1DatabaseObject";

// workerd の ActorIdFactoryImpl（src/workerd/server/actor-id-impl.c++）の
// idFromName() と同じ計算。ローカル実行では namespace の uniqueKey の
// SHA-256 を HMAC キーにして、ID 前半 16 バイトを name の HMAC、
// 後半 16 バイトを前半の HMAC で作る。
const ID_BASE_LENGTH = 16;

export function d1ObjectIdFromName(name, uniqueKey = D1_OBJECT_UNIQUE_KEY) {
  const key = createHash("sha256").update(uniqueKey).digest();
  const base = createHmac("sha256", key)
    .update(name)
    .digest()
    .subarray(0, ID_BASE_LENGTH);
  const mac = createHmac("sha256", key)
    .update(base)
    .digest()
    .subarray(0, ID_BASE_LENGTH);
  return Buffer.concat([base, mac]).toString("hex");
}

// drizzle-kit は --env を取らず常にデフォルト env（トップレベル）の
// 設定でローカル D1 を見るため、env.* 配下の d1_databases は拾わない。
export function localD1DatabaseIds(config) {
  if (!Array.isArray(config?.d1_databases)) {
    return [];
  }
  return config.d1_databases
    .map((binding) => binding?.database_id)
    .filter((id) => typeof id === "string");
}

export function resolveLocalD1Sqlite(databaseIds, files) {
  if (databaseIds.length === 0) {
    throw new Error(
      "wrangler.toml のデフォルト env に d1_databases がありません。",
    );
  }
  const expected = new Set(
    databaseIds.map((id) => `${d1ObjectIdFromName(id)}.sqlite`),
  );
  const matches = files.filter(
    (f) => f.endsWith(".sqlite") && f !== "metadata.sqlite" && expected.has(f),
  );

  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `ローカルD1のSQLiteファイルが見つかりません。` +
            `先に 'vp run @animeishi/api#dev' を一度起動してください。` +
            `（期待するファイル: ${[...expected].join(", ")}）`
        : `ローカルD1のSQLiteファイルを1つに絞れません: ${matches.join(", ")}`,
    );
  }

  return matches[0];
}
