import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

// contracts（RNクライアント）が@cloudflare/workers-typesなしでAppTypeをimportできるよう
// Env['DB']はD1Databaseに依存しない構造的型で表現する。
// createDbはWorkerランタイム内でのみ呼ばれるため、実装では D1Database 型を使う。
export type Env = {
  DB: unknown;
};

/**
 * D1バインディングからDrizzle ORMクライアントを生成する。
 * 直接このクライアントを使ったDB操作は禁止。
 * 必ず authorizedDb（リポジトリ層）を経由すること。
 */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type DrizzleDb = ReturnType<typeof createDb>;
