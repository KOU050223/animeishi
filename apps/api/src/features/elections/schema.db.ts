import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
  check,
} from "drizzle-orm/sqlite-core";
import { users } from "#src/features/users/schema.db";

// ---- elections (期間限定の投票型「総選挙」, issue #438) ----
// 投入は scripts/publish-election.mjs（#437 の記事と同じ frontmatter 付き
// Markdown → slug upsert）が担い、API 経路では書き込まない。
// starts_at 〜 ends_at が投票期間（両端を含む）、published_at 〜
// unpublished_at が公開期間（events と同じ考え方）。
export const elections = sqliteTable(
  "elections",
  {
    slug: text("slug").primaryKey(),
    title: text("title").notNull(),
    // 説明文 Markdown。省略可（お題と候補だけの登録を許すため nullable）。
    body: text("body"),
    coverImageUrl: text("cover_image_url"),
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp" }).notNull(),
    publishedAt: integer("published_at", { mode: "timestamp" }).notNull(),
    unpublishedAt: integer("unpublished_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("elections_published_idx").on(t.publishedAt)],
);

// ---- election_candidates (総選挙の候補, issue #438) ----
// 候補の表示名と画像は投入時に frontmatter から書き写して持つ（D1 の
// Annict キャッシュに無い候補も出せるよう非正規化）。再投入で frontmatter
// から外れた行は削除され、その候補への票は ON DELETE CASCADE で消える。
export const ELECTION_CANDIDATE_KINDS = ["character", "work"] as const;

export const electionCandidates = sqliteTable(
  "election_candidates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    electionSlug: text("election_slug")
      .notNull()
      .references(() => elections.slug, { onDelete: "cascade" }),
    // 'character'（Annict Character.annictId）| 'work'（Annict Work.annictId）。
    kind: text("kind", { enum: ELECTION_CANDIDATE_KINDS }).notNull(),
    annictId: integer("annict_id").notNull(),
    name: text("name").notNull(),
    imageUrl: text("image_url"),
    // frontmatter の candidates の並び順。表示順はこれに従う。
    position: integer("position").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("election_candidates_election_kind_annict_unique").on(
      t.electionSlug,
      t.kind,
      t.annictId,
    ),
    index("election_candidates_election_idx").on(t.electionSlug),
    check(
      "election_candidates_kind_check",
      sql`${t.kind} IN ('character', 'work')`,
    ),
  ],
);

// ---- election_votes (総選挙の票, issue #438) ----
// 行が存在する = 投票済み。(election_slug, user_id) の一意制約で
// 1 アカウント 1 票を担保し、期間中の投票先変更は candidate_id の更新。
// 得票数は API から返さない（途中経過を公開しない決定）。結果は運営が
// D1 で集計して特集記事（issue #437）として出す。
export const electionVotes = sqliteTable(
  "election_votes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    electionSlug: text("election_slug")
      .notNull()
      .references(() => elections.slug, { onDelete: "cascade" }),
    candidateId: integer("candidate_id")
      .notNull()
      .references(() => electionCandidates.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("election_votes_election_user_unique").on(t.electionSlug, t.userId),
    index("election_votes_candidate_idx").on(t.candidateId),
  ],
);

export type Election = typeof elections.$inferSelect;
export type ElectionCandidate = typeof electionCandidates.$inferSelect;
