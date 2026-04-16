import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/db/schema";

// D1Databaseを直接参照しないことでcontracts（RNクライアント）が
// @cloudflare/workers-typesなしでAppTypeをimportできる
export type Env = {
  DB: { prepare: (query: string) => unknown };
};

/**
 * D1バインディングからDrizzle ORMクライアントを生成する。
 * 直接このクライアントを使ったDB操作は禁止。
 * 必ず authorizedDb（リポジトリ層）を経由すること。
 */
export function createDb(d1: Env["DB"]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return drizzle(d1 as any, { schema });
}

export type DrizzleDb = ReturnType<typeof createDb>;
