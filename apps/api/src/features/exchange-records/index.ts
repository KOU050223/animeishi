import type { Context } from "hono";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "#src/middleware/auth";
import type { AuthEnv, AuthVariables } from "#src/middleware/auth";
import {
  EventNotFoundError,
  ExchangeRecordNotFoundError,
  NotFriendError,
  exchangeRecordsRepository,
} from "./repository";
import { EXCHANGE_CARD_SNAPSHOT_KEY_PREFIX } from "./cardSnapshot";
import {
  createExchangeRecordRoute,
  deleteExchangeRecordRoute,
  exchangeCardSnapshotRoute,
  listExchangeRecordsRoute,
  updateExchangeRecordRoute,
} from "./schema";
import { createDb } from "#src/db/client";
import { exchangeRecords as exchangeRecordsTable } from "#src/db/schema";
import { createOpenApiApp } from "#src/lib/openapi";
import type { ExchangeRecord } from "#src/db/schema";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database; AVATARS: R2Bucket } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & {
    DB: D1Database;
    AVATARS: R2Bucket;
  };
}

// 名刺コピー（issue #662）の配信 URL。自分専用の非公開コピーなので
// 公開配信の meishi-assets とは別に、本人認証付きのこのエンドポイント
// 経由でだけ返す。
function cardSnapshotUrl(requestUrl: string, recordId: number): string {
  const url = new URL(requestUrl);
  url.pathname = `/me/exchange-records/${recordId}/snapshot`;
  url.search = "";
  return url.toString();
}

function toJson(record: ExchangeRecord, requestUrl: string) {
  return {
    id: record.id,
    friendId: record.friendId,
    source: record.source,
    metAt: record.metAt.toISOString(),
    placeName: record.placeName,
    eventSlug: record.eventSlug,
    eventName: record.eventName,
    cardSnapshotUrl: record.cardSnapshotKey
      ? cardSnapshotUrl(requestUrl, record.id)
      : null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

// 交換記録（issue #661 / #662）。「いつ・どこで・どのイベントで」交換したかを
// 本人の名刺帳にだけ残す私的な履歴。owner は常に認証ユーザー自身で、
// 相手・第三者には返さないため /me 直下のエンドポイントだけを持つ。
const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);

const exchangeRecords = app
  .openapi(createExchangeRecordRoute, async (c) => {
    const { friendId, ...input } = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = exchangeRecordsRepository(
      db,
      c.var.clerkUserId,
      getBindings(c).AVATARS,
    );
    try {
      const { record, created } = await repo.create(friendId, input);
      return c.json(toJson(record, c.req.url), created ? 201 : 200);
    } catch (e) {
      if (e instanceof NotFriendError) {
        return c.json({ error: "フレンドではありません" }, 404);
      }
      if (e instanceof EventNotFoundError) {
        return c.json({ error: "イベントが見つかりません" }, 400);
      }
      throw e;
    }
  })
  .openapi(listExchangeRecordsRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = exchangeRecordsRepository(db, c.var.clerkUserId);
    const rows = await repo.listMine();
    return c.json(
      rows.map((r) => toJson(r, c.req.url)),
      200,
    );
  })
  .openapi(updateExchangeRecordRoute, async (c) => {
    const { recordId } = c.req.valid("param");
    const input = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = exchangeRecordsRepository(db, c.var.clerkUserId);
    try {
      const updated = await repo.update(recordId, input);
      return c.json(toJson(updated, c.req.url), 200);
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
      // 記録に紐付く名刺コピー（issue #662）も R2 から消す。
      // R2 を先に消すのは、削除が失敗したとき D1 行が残っていれば
      // 再試行で同じキーを消せるようにするため（逆順だと行は消えて
      // コピーだけが残る）。
      const snapshotKey = await repo.snapshotKeyForDelete(recordId);
      if (snapshotKey) {
        await getBindings(c).AVATARS.delete(snapshotKey);
      }
      await repo.remove(recordId);
      return c.json({ success: true }, 200);
    } catch (e) {
      if (e instanceof ExchangeRecordNotFoundError) {
        return c.json({ error: "交換記録が見つかりません" }, 404);
      }
      throw e;
    }
  })
  // 交換当時の名刺コピー（issue #662）を本人認証付きで配信する。
  // コピーは本人専用のため公開配信の meishi-assets とは別経路にし、
  // 記録の owner 以外（相手・第三者）には 404 で存在も漏らさない。
  .openapi(exchangeCardSnapshotRoute, async (c) => {
    const recordId = Number(c.req.valid("param").recordId);
    if (!Number.isInteger(recordId) || recordId <= 0) {
      return c.json({ error: "Not found" }, 404);
    }
    const db = createDb(getBindings(c).DB);
    const record = await db.query.exchangeRecords.findFirst({
      where: and(
        eq(exchangeRecordsTable.id, recordId),
        eq(exchangeRecordsTable.ownerId, c.var.clerkUserId),
      ),
      columns: { cardSnapshotKey: true },
    });
    const key = record?.cardSnapshotKey;
    // 防御として owner のプレフィックス配下のキーだけを配信する
    // （card_snapshot_key が何らかの経路で別プレフィックスを指しても
    // ここで弾く）。
    if (
      !key ||
      !key.startsWith(
        `${EXCHANGE_CARD_SNAPSHOT_KEY_PREFIX}${c.var.clerkUserId}/`,
      )
    ) {
      return c.json({ error: "Not found" }, 404);
    }
    const object = await getBindings(c).AVATARS.get(key);
    if (!object) {
      return c.json({ error: "Not found" }, 404);
    }
    // コピーはキーごとにイミュータブル（記録ごとに新キー）。本人専用なので
    // private キャッシュに留め、共有キャッシュへは載せない。クライアントは
    // Authorization ヘッダ付きで取るため Vary を付け、別ユーザーの
    // クレデンシャルではキャッシュが再利用されないようにする。
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("cache-control", "private, max-age=31536000, immutable");
    headers.set("vary", "Authorization");
    return new Response(object.body, { headers });
  });

export { exchangeRecords };
