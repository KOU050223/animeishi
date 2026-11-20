import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  EventNotFoundError,
  ExchangeRecordNotFoundError,
  exchangeRecordsRepository,
} from "./repository";
import {
  deleteExchangeRecordRoute,
  listExchangeRecordsRoute,
  updateExchangeRecordRoute,
} from "./schema";
import { createDb } from "@/db/client";
import { createOpenApiApp } from "@/lib/openapi";
import type { ExchangeRecord } from "@/db/schema";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

function toJson(record: ExchangeRecord) {
  return {
    id: record.id,
    friendId: record.friendId,
    source: record.source,
    metAt: record.metAt.toISOString(),
    placeName: record.placeName,
    eventSlug: record.eventSlug,
    eventName: record.eventName,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// 交換記録（issue #661）。「いつ・どこで・どのイベントで」交換したかを
// 本人の名刺帳にだけ残す私的な履歴。owner は常に認証ユーザー自身で、
// 相手・第三者には返さないため /me 直下のエンドポイントだけを持つ。
const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);

const exchangeRecords = app
  .openapi(listExchangeRecordsRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = exchangeRecordsRepository(db, c.var.clerkUserId);
    const rows = await repo.listMine();
    return c.json(rows.map(toJson), 200);
  })
  .openapi(updateExchangeRecordRoute, async (c) => {
    const { recordId } = c.req.valid("param");
    const input = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = exchangeRecordsRepository(db, c.var.clerkUserId);
    try {
      const updated = await repo.update(recordId, input);
      return c.json(toJson(updated), 200);
    } catch (e) {
      if (e instanceof ExchangeRecordNotFoundError) {
        return c.json({ error: "交換記録が見つかりません" }, 404);
      }
      if (e instanceof EventNotFoundError) {
        return c.json({ error: "イベントが見つかりません" }, 400);
      }
      throw e;
    }
  })
  .openapi(deleteExchangeRecordRoute, async (c) => {
    const { recordId } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = exchangeRecordsRepository(db, c.var.clerkUserId);
    try {
      await repo.remove(recordId);
      return c.json({ success: true }, 200);
    } catch (e) {
      if (e instanceof ExchangeRecordNotFoundError) {
        return c.json({ error: "交換記録が見つかりません" }, 404);
      }
      throw e;
    }
  });

export { exchangeRecords };
