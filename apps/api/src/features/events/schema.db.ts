import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
} from "drizzle-orm/sqlite-core";
import { users } from "@/features/users/schema.db";

// ---- events (運営が登録する大型イベント, issue #411) ----
// 投入は scripts/publish-event.mjs（#437 の記事と同じ frontmatter 付き
// Markdown → slug upsert）が担い、API 経路では書き込まない。
// starts_at 〜 ends_at が会期（名刺交換のまとめ対象期間・両端を含む）、
// published_at 〜 unpublished_at が公開期間（articles と同じ考え方）。
export const events = sqliteTable(
  "events",
  {
    slug: text("slug").primaryKey(),
    title: text("title").notNull(),
    // 説明文 Markdown。省略可（日程・会場だけの登録を許すため nullable）。
    body: text("body"),
    coverImageUrl: text("cover_image_url"),
    // 会場名（例: 東京ビッグサイト）と公式サイト URL。
    location: text("location"),
    officialUrl: text("official_url"),
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp" }).notNull(),
    publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
    unpublishedAt: integer("unpublished_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("events_published_idx").on(t.publishedAt)],
);

// ---- event_participations (「参加する」表明, issue #411) ----
// 行が存在する = 参加表明中。visibility（issue #440）が表明の公開範囲:
// 'public' は誰にでも参加者一覧へ出る、'friends' はフレンドのイベント
// 詳細にだけ出る、'private' は本人のみ（既定。フェーズ 1 と同じ扱い）。
export const EVENT_PARTICIPATION_VISIBILITIES = [
  "public",
  "friends",
  "private",
] as const;
export type EventParticipationVisibility =
  (typeof EVENT_PARTICIPATION_VISIBILITIES)[number];

export const eventParticipations = sqliteTable(
  "event_participations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    eventSlug: text("event_slug")
      .notNull()
      .references(() => events.slug, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    visibility: text("visibility", {
      enum: EVENT_PARTICIPATION_VISIBILITIES,
    })
      .notNull()
      .default("private"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("event_participations_event_user_unique").on(t.eventSlug, t.userId),
    index("event_participations_user_idx").on(t.userId),
  ],
);

export type Event = typeof events.$inferSelect;
