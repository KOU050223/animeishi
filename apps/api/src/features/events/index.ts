import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { eventsRepository } from "./repository";
import {
  cancelParticipationRoute,
  getEventRoute,
  getExchangedFriendsRoute,
  getParticipantsRoute,
  listEventsRoute,
  participateEventRoute,
  updateParticipationRoute,
} from "./schema";
import { createDb } from "@/db/client";
import { createOpenApiApp } from "@/lib/openapi";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// 1 ページの既定・上限件数。ホームのイベント枠は limit で絞って引く。
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// 参加者一覧の既定・上限件数（issue #440）。参加者はイベントごとに
// 集まりうるため一覧より緩い上限にする。超過分は participantTotal だけを返す。
const PARTICIPANTS_DEFAULT_LIMIT = 100;
const PARTICIPANTS_MAX_LIMIT = 500;

// 運営が登録するイベント（issue #411 フェーズ 1）。投入は
// scripts/publish-event.mjs（frontmatter 付き Markdown の upsert）
// が担う。公開期間（published_at 〜 unpublished_at）外のイベントは
// 一覧・詳細ともに返さない。
// 「参加する」の表明には公開範囲（issue #440 の public / friends /
// private、既定 private）があり、公開範囲に応じて参加者一覧・
// 「参加しているフレンド」欄に出る。「会期中に成立したフレンドの一覧」
// は本人にのみ公開する（フレンドには出さない）。
const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);

const toIso = (d: Date) => d.toISOString();

const events = app
  .openapi(listEventsRoute, async (c) => {
    const { limit: rawLimit } = c.req.valid("query");
    const limit = Math.min(Number(rawLimit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const db = createDb(getBindings(c).DB);
    const repo = eventsRepository(db, c.var.clerkUserId);

    const rows = await repo.listPublished({ now: new Date(), limit });

    return c.json(
      {
        items: rows.map((row) => ({
          ...row,
          startsAt: toIso(row.startsAt),
          endsAt: toIso(row.endsAt),
        })),
      },
      200,
    );
  })
  .openapi(getEventRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = eventsRepository(db, c.var.clerkUserId);

    const event = await repo.getPublished({ slug, now: new Date() });
    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    return c.json(
      {
        slug: event.slug,
        title: event.title,
        body: event.body,
        coverImageUrl: event.coverImageUrl,
        location: event.location,
        officialUrl: event.officialUrl,
        startsAt: toIso(event.startsAt),
        endsAt: toIso(event.endsAt),
        participating: event.participating,
        participationVisibility: event.participationVisibility,
      },
      200,
    );
  })
  .openapi(participateEventRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = eventsRepository(db, c.var.clerkUserId);

    // 公開期間外・存在しないイベントへの表明は詳細と同じく 404 に寄せる。
    const event = await repo.getPublished({ slug, now: new Date() });
    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    await repo.addParticipation(slug);
    return c.json({ success: true }, 200);
  })
  .openapi(updateParticipationRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const { visibility } = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = eventsRepository(db, c.var.clerkUserId);

    const event = await repo.getPublished({ slug, now: new Date() });
    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }
    if (!event.participating) {
      // 公開範囲の変更は表明済みの参加だけに許す。未表明への PATCH で
      // 参加表明が新規に作られないようにする（issue #440）。
      return c.json(
        { error: "イベントに参加表明していません", code: "not_participating" },
        403,
      );
    }

    await repo.setParticipationVisibility(slug, visibility);
    return c.json({ success: true }, 200);
  })
  .openapi(getParticipantsRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const { limit: rawLimit } = c.req.valid("query");
    const limit = Math.min(
      Number(rawLimit ?? PARTICIPANTS_DEFAULT_LIMIT),
      PARTICIPANTS_MAX_LIMIT,
    );
    const db = createDb(getBindings(c).DB);
    const repo = eventsRepository(db, c.var.clerkUserId);

    const event = await repo.getPublished({ slug, now: new Date() });
    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }

    const [participants, participantTotal, friends] = await Promise.all([
      repo.listPublicParticipants({ eventSlug: slug, limit }),
      repo.countPublicParticipants(slug),
      repo.listParticipatingFriends(slug),
    ]);
    return c.json({ participants, participantTotal, friends }, 200);
  })
  .openapi(cancelParticipationRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = eventsRepository(db, c.var.clerkUserId);

    await repo.removeParticipation(slug);
    return c.json({ success: true }, 200);
  })
  .openapi(getExchangedFriendsRoute, async (c) => {
    const { slug } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = eventsRepository(db, c.var.clerkUserId);

    const event = await repo.getPublished({ slug, now: new Date() });
    if (!event) {
      return c.json({ error: "Event not found" }, 404);
    }
    if (!event.participating) {
      // 名刺まとめは参加表明したイベントだけに出す（issue #411）。
      return c.json(
        { error: "イベントに参加表明していません", code: "not_participating" },
        403,
      );
    }

    const rows = await repo.listExchangedFriends({
      startsAt: event.startsAt,
      endsAt: event.endsAt,
    });
    return c.json(
      {
        items: rows.map((row) => ({
          ...row,
          createdAt: toIso(row.createdAt),
        })),
      },
      200,
    );
  });

export { events };
