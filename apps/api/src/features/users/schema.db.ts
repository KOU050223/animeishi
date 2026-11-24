import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
} from "drizzle-orm/sqlite-core";

// ---- users ----
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(), // Clerk user ID (user_xxxxx)
    username: text("username").notNull(),
    bio: text("bio"),
    favoriteQuote: text("favorite_quote"),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(true),
    // 公開一覧（みつける の名刺・作品リスト・Tier 表、イベントの公開
    // 参加者）からの除外理由（issue #580）。NULL = 一覧に出す。
    // 'demo'（審査用デモアカウント）・'banned'（モデレーション除外）等を
    // 運営が D1 に直接書く運用で、クエリ側は NULL 判定だけを行う。
    // 詳細・共有リンク・フレンド一覧など一覧以外の参照は除外しない。
    publicListExclusion: text("public_list_exclusion"),
    profileImageUrl: text("profile_image_url"),
    // 視聴履歴の共有 URL（/share/watch-history/:token）のトークン。null は未共有。
    // 発行は POST /me/watch-histories/share、破棄は DELETE で行う。
    // is_public（プロフィール公開）とは独立した、トークンを知る人だけが
    // 読める共有（issue #236）。
    watchHistoryShareToken: text("watch_history_share_token"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    // 共有リンクからの引き当てキー。SQLite では NULL は互いに異なる値として
    // 扱われるため、未共有行が複数あってもユニーク制約に抵触しない。
    unique("users_watch_history_share_token_unique").on(
      t.watchHistoryShareToken,
    ),
  ],
);

// ---- user_likes (名刺へのいいね, issue #418) ----
// 公開プロフィール（/user/:uid の名刺）へのいいね。プロフィール公開設定
// （users.is_public）をそのまま公開条件として使う。
// (user_id, liked_user_id) で 1 件。どちら側の削除でも cascade。
export const userLikes = sqliteTable(
  "user_likes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    likedUserId: text("liked_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("user_likes_user_target_unique").on(t.userId, t.likedUserId),
    index("user_likes_target_idx").on(t.likedUserId),
  ],
);

// ---- blocks (ユーザーブロック) ----
// App Store Guideline 1.2 (UGC) 対応。blocker が blocked を見えなくする。
// ブロックは双方向で効かせる（自分がブロックした相手も、自分をブロックした相手も
// フレンド一覧・名刺閲覧・フレンド追加から除外される）。
export const blocks = sqliteTable(
  "blocks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    blockerId: text("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: text("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("blocks_blocker_blocked_unique").on(t.blockerId, t.blockedId),
    index("blocks_blocker_idx").on(t.blockerId),
    index("blocks_blocked_idx").on(t.blockedId),
  ],
);

// ---- deleted_users (アカウント削除の tombstone) ----
// DELETE /me で users 行を削除した記録。削除済みユーザーの残存 JWT が
// ensureUserExists / upsertMyProfile 経由で users 行を再作成し、
// 公開プロフィールが残るのを防ぐ（issue #144）。
// 削除と同一 batch で書き込むため「行は消えたが tombstone が無い」窓は無い。
// 他テーブルへの FK は持たせない（users 行が存在しない状態で書くため）。
export const deletedUsers = sqliteTable("deleted_users", {
  userId: text("user_id").primaryKey(), // 削除された Clerk user ID
  deletedAt: integer("deleted_at", { mode: "timestamp" }).notNull(),
});

// ---- user_genres (選択ジャンル) ----
export const userGenres = sqliteTable(
  "user_genres",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    genre: text("genre").notNull(),
  },
  (t) => [
    unique("user_genres_user_genre_unique").on(t.userId, t.genre),
    index("user_genres_user_idx").on(t.userId),
  ],
);

// ---- deletion_feedbacks (退会理由の匿名記録, issue #426) ----
// 退会フローで任意入力された理由を、退会後も集計できるよう user_id と
// 紐付けずに保存する。個人を特定できる列（user_id・メール等）は持たない。
// users への FK も持たせない（削除されたユーザーとの関連付けを残さないため）。
export const deletionFeedbacks = sqliteTable("deletion_feedbacks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // 選択理由キーの JSON 配列（キーはクライアント側で管理する）。
  reasons: text("reasons").notNull(),
  freeText: text("free_text"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
