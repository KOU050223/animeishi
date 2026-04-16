import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export type Env = {
  DB: D1Database;
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
