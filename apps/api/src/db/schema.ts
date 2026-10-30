import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  unique,
  check,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// Annict の StatusState（watch_history.state の許可値）
export const WATCH_STATES = [
  "WATCHING",
  "WATCHED",
  "ON_HOLD",
  "STOP_WATCHING",
  "WANNA_WATCH",
] as const;

// reports.status の許可値（モデレーション対応状況, issue #186）。
// open: 未対応 / resolved: 対応済み / dismissed: 却下（対応不要と判断）。
export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

// ---- users ----
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(), // Clerk user ID (user_xxxxx)
    username: text("username").notNull(),
    bio: text("bio"),
    favoriteQuote: text("favorite_quote"),
    isPublic: integer("is_public", { mode: "boolean" }).notNull().default(true),
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

// ---- annict_works (Annict 作品キャッシュ) ----
export const annictWorks = sqliteTable("annict_works", {
  annictWorkId: integer("annict_work_id").primaryKey(), // Annict の annictId をそのまま主キー
  // Annict GraphQL の Work Node ID（Base64）。updateStatus(input.workId) が
  // この Node ID を要求するため、read-through 時に取得して保持する。annictId(Int)
  // とは別物。read-through 前に更新が来た作品では未取得（null）で、その場合は
  // 更新時に searchWorks で解決してから埋める。
  nodeId: text("node_id"),
  title: text("title").notNull(),
  titleKana: text("title_kana"),
  titleEn: text("title_en"),
  seasonName: text("season_name"), // 例: "2026-spring"
  seasonYear: integer("season_year"),
  imageUrl: text("image_url"),
  // Annict Work.malAnimeId。外部画像フォールバック（Kitsu/Jikan）の引き当てキーに使う。
  malAnimeId: integer("mal_anime_id"),
  // 画像フォールバック解決後に埋まる。空なら imageUrl or プレースホルダー、非空なら
  // これを優先して表示する。imageSource でどの供給元か判別できる。
  resolvedImageUrl: text("resolved_image_url"),
  // 'annict' | 'anilist' | 'jikan' | 'none'。'none' は MAL ID が誤り or 供給元にも
  // 画像が無いことが判明したネガキャッシュ。null は未解決（一度も試していない）。
  // 'blocked' は削除依頼で画像を消した作品で、二度と補完しない（issue #241）。
  imageSource: text("image_source"),
  // resolvedImageUrl / imageSource を確定した時刻。TTL 再解決の起点に使う。
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
  // 画像フォールバック解決を最後に試行した時刻。cron が未解決作品を直接回す際の
  // クールダウンに使い、429 等で解決できなかった作品の叩き直し頻度を抑える
  // （issue #127）。updateResolvedImage で解決時にクリアし、mal_anime_id 変化時にも
  // リセットする。クールダウン切れ後は再試行対象に戻る。
  imageFallbackAttemptedAt: integer("image_fallback_attempted_at", {
    mode: "timestamp",
  }),
  // R2 に取り込み済みの作品画像のオブジェクトキー
  // （works/<annictWorkId>/<sourceUrlHash>.<ext>）。画像プロキシ
  // GET /images/works/:id が表示時に外部から取り込んで記録する。
  // null は未取り込み。
  imageR2Key: text("image_r2_key"),
  // 画像プロキシが取り込みを試行した時刻（取り込み成功時・全候補失敗時）。
  // 全候補失敗の作品をクールダウン中は外部に叩き直さないために使う。
  imageR2AttemptedAt: integer("image_r2_attempted_at", {
    mode: "timestamp",
  }),
  // MAL ID を持たない作品のタイトル検索（issue #223 / #227）を最後に
  // 試行した時刻。見つからなかった作品をクールダウン中は検索し直さない。
  malSearchAttemptedAt: integer("mal_search_attempted_at", {
    mode: "timestamp",
  }),
  // Kitsu のタイトル検索（issue #227）で一致した Kitsu 作品の ID。
  // mappings に myanimelist/anime が無い作品（新作に多い）は mal_anime_id を
  // 書き戻せないため、画像プロキシがこの ID から Kitsu のポスターを引く
  // 代わりのキーにする。
  kitsuAnimeId: integer("kitsu_anime_id"),
  // Annict Work.watchersCount（作品の人気指標）。ライブラリ read-through で
  // 同期する。視聴履歴の「視聴者数順」ソートに使う（issue #345）。
  // null は未取得（read-through 経路以外でキャッシュされた作品）。
  watchersCount: integer("watchers_count"),
  // ジャンル・タグ名の配列（issue #346）。Annict にジャンルは無いため、
  // cron が mal_anime_id / kitsu_anime_id 経由で Kitsu categories
  // （無ければ MAL genres+themes）を取り込んで保持する。
  // null は未取得（絞り込みでは「不明」扱い）。空配列は「取得済みだが
  // 供給元にも無い」確定値で、長めの TTL で再取得される。
  genres: text("genres", { mode: "json" }).$type<string[]>(),
  // ジャンル取得に最後に成功した時刻。空配列確定値の再取得 TTL の起点。
  genresFetchedAt: integer("genres_fetched_at", { mode: "timestamp" }),
  // ジャンル取得を最後に試行した時刻。cron が未取得作品を回す際の
  // クールダウンに使う。成功時刻と分けないと、空配列の TTL 再取得が
  // 失敗したとき試行時刻の更新で再試行が TTL 分先送りになる。
  genresAttemptedAt: integer("genres_attempted_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---- annict_tokens (Web 連携用の暗号化トークン保存) ----
// Web(ブラウザ)連携では SecureStore が無く localStorage は XSS リスクがあるため、
// Annict アクセストークンを AES-GCM で暗号化して D1 に保存し、HttpOnly Cookie の
// セッションから参照する（詳細は docs/05 追補）。ネイティブは従来のヘッダ方式で
// このテーブルは使わない。userId(Clerk) 単位で 1 トークンを持つ。
export const annictTokens = sqliteTable("annict_tokens", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // encryptToken() が返す base64(iv||ciphertext)。平文は保存しない。
  encryptedToken: text("encrypted_token").notNull(),
  // Annict 側のトークン所有者 ID（表示・突き合わせ用）。
  annictUserId: integer("annict_user_id"),
  scope: text("scope"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---- watch_history (Annict ライブラリのキャッシュ) ----
export const watchHistory = sqliteTable(
  "watch_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    state: text("state", { enum: WATCH_STATES }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("watch_history_user_work_unique").on(t.userId, t.annictWorkId),
    index("watch_history_user_idx").on(t.userId),
    check(
      "watch_history_state_check",
      sql`${t.state} IN ('WATCHING', 'WATCHED', 'ON_HOLD', 'STOP_WATCHING', 'WANNA_WATCH')`,
    ),
  ],
);

// ---- favorites ----
export const favorites = sqliteTable(
  "favorites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("favorites_user_work_unique").on(t.userId, t.annictWorkId),
    index("favorites_user_idx").on(t.userId),
  ],
);

// ---- friends ----
export const friends = sqliteTable(
  "friends",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendId: text("friend_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    unique("friends_user_friend_unique").on(t.userId, t.friendId),
    index("friends_user_idx").on(t.userId),
  ],
);

// ---- tier_lists (シーズン単位のアニメ tier 表) ----
// tiers（S/A/B... の行定義）は行数・ラベル・色をユーザーが自由に決められるため
// 正規化せず JSON 1 カラムに持つ。行の並び順は配列順そのもの。
// 別テーブルにすると「行の並べ替え」がそのまま position 更新の一括 UPDATE になり、
// MVP の費用対効果に見合わない。
export const tierLists = sqliteTable(
  "tier_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 対象シーズン。annict_works.seasonName と同じ "2026-spring" 形式。
    season: text("season").notNull(),
    title: text("title").notNull(),
    // TierRow[] の JSON 文字列。{ key, label, color } を並び順に持つ。
    tiersJson: text("tiers_json").notNull(),
    // 共有 URL（/share/tier-lists/:token）のトークン。null は未共有。
    // 発行は POST /me/tier-lists/:season/share、破棄は DELETE で行う。
    shareToken: text("share_token"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    // 1 ユーザー 1 シーズンにつき 1 表。作り直しは上書きで済ませる。
    unique("tier_lists_user_season_unique").on(t.userId, t.season),
    index("tier_lists_user_idx").on(t.userId),
    // 共有リンクからの引き当てキー。SQLite では NULL は互いに異なる値として
    // 扱われるため、未共有行が複数あってもユニーク制約に抵触しない。
    unique("tier_lists_share_token_unique").on(t.shareToken),
  ],
);

// ---- tier_list_items (tier 表に配置された作品) ----
// 未配置（どの tier にも入れていない）作品はここに行を持たない。
// 「シーズン全作品 - 配置済み」がクライアント側の未分類トレイになる。
export const tierListItems = sqliteTable(
  "tier_list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tierListId: integer("tier_list_id")
      .notNull()
      .references(() => tierLists.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    // tiersJson 内の TierRow.key を指す。FK は張れないため整合性はアプリ層で担保する。
    tierKey: text("tier_key").notNull(),
    // 同一 tier 内での左からの並び順。
    position: integer("position").notNull(),
  },
  (t) => [
    unique("tier_list_items_list_work_unique").on(t.tierListId, t.annictWorkId),
    index("tier_list_items_list_idx").on(t.tierListId),
  ],
);

// ---- annict_characters (Annict キャラクターキャッシュ) ----
// Annict GraphQL の Character 型は画像フィールドを持たないため、image_url は
// Kitsu からの名寄せ結果（見つからなければ null）。works と同じく
// read-through で upsert する共有カタログとして扱い、ユーザー行の削除時は
// 触らない（tier 表アイテムの FK 先として残す）。
export const annictCharacters = sqliteTable("annict_characters", {
  annictCharacterId: integer("annict_character_id").primaryKey(), // Annict の annictId
  name: text("name").notNull(),
  nameKana: text("name_kana"),
  nameEn: text("name_en"),
  // Kitsu のキャラクター一覧から名前正規化マッチで解決した画像 URL。
  // null は未解決（表示側はフォールバック表示にする）。
  imageUrl: text("image_url"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

// ---- annict_work_casts (作品→キャラクターの所属カタログ) ----
// /works/:id/characters が Annict Work.casts から読み取った所属を保持する。
// annict_characters は作品を跨いだ共有カタログのため、ここが無いと
// 保存時に「その作品のキャストか」を検証できず、別作品のキャラクターを
// tier 表に混入できてしまう。
export const annictWorkCasts = sqliteTable(
  "annict_work_casts",
  {
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    annictCharacterId: integer("annict_character_id")
      .notNull()
      .references(() => annictCharacters.annictCharacterId, {
        onDelete: "cascade",
      }),
    sortNumber: integer("sort_number").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.annictWorkId, t.annictCharacterId] }),
    index("annict_work_casts_work_idx").on(t.annictWorkId),
  ],
);

// ---- character_tier_lists (作品単位のキャラクター tier 表) ----
// 作品 tier 表（tier_lists）のキャラクター版。対象の単位が「シーズン」ではなく
// 「作品」になるため annict_work_id をスコープキーに持つ。
export const characterTierLists = sqliteTable(
  "character_tier_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // 対象作品。items のキャラクターはこの作品のキャストから選ばれる前提。
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    title: text("title").notNull(),
    tiersJson: text("tiers_json").notNull(),
    shareToken: text("share_token"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    // 1 ユーザー 1 作品につき 1 表。作り直しは上書きで済ませる。
    unique("character_tier_lists_user_work_unique").on(
      t.userId,
      t.annictWorkId,
    ),
    index("character_tier_lists_user_idx").on(t.userId),
    unique("character_tier_lists_share_token_unique").on(t.shareToken),
  ],
);

// ---- character_tier_list_items (キャラクター tier 表に配置されたキャラクター) ----
export const characterTierListItems = sqliteTable(
  "character_tier_list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    characterTierListId: integer("character_tier_list_id")
      .notNull()
      .references(() => characterTierLists.id, { onDelete: "cascade" }),
    annictCharacterId: integer("annict_character_id")
      .notNull()
      .references(() => annictCharacters.annictCharacterId, {
        onDelete: "cascade",
      }),
    tierKey: text("tier_key").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    unique("character_tier_list_items_list_character_unique").on(
      t.characterTierListId,
      t.annictCharacterId,
    ),
    index("character_tier_list_items_list_idx").on(t.characterTierListId),
  ],
);

// ---- custom_tier_lists (テーマ名を付けた自由作成の作品 tier 表) ----
// tier_lists（シーズン版）と違い対象の作品集合をシーズンで縛らない。
// シーズン版は「1 ユーザー 1 シーズン 1 表」の upsert だが、こちらは
// 1 人で複数作れるためスコープキーを持たず、id で識別する。
export const customTierLists = sqliteTable(
  "custom_tier_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // ユーザーが付けるテーマ名（「歴代で好きなアニメ」など）。
    title: text("title").notNull(),
    tiersJson: text("tiers_json").notNull(),
    // 共有 URL（/share/custom-tier-lists/:token）のトークン。null は未共有。
    shareToken: text("share_token"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("custom_tier_lists_user_idx").on(t.userId),
    unique("custom_tier_lists_share_token_unique").on(t.shareToken),
  ],
);

// ---- custom_tier_list_items (自由作成 tier 表に配置された作品) ----
// 未配置（どの tier にも入れていない）作品は行を持たない。シーズン版と
// 違い「候補一覧 - 配置済み」の未分類は存在せず、未配置のままだと消える。
export const customTierListItems = sqliteTable(
  "custom_tier_list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    customTierListId: integer("custom_tier_list_id")
      .notNull()
      .references(() => customTierLists.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    tierKey: text("tier_key").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    unique("custom_tier_list_items_list_work_unique").on(
      t.customTierListId,
      t.annictWorkId,
    ),
    index("custom_tier_list_items_list_idx").on(t.customTierListId),
  ],
);

// ---- work_lists (タイトル・説明付きのオリジナル作品リスト) ----
// favorites（推し）とは別機能で、1 人 1 一覧の favorites と違い
// テーマ別に複数作れるためスコープキーを持たず id で識別する
// （custom_tier_lists と同じ判断）。
export const workLists = sqliteTable(
  "work_lists",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    // リストの説明文。null は未設定。
    description: text("description"),
    // 共有 URL（/share/work-lists/:token）のトークン。null は未共有。
    shareToken: text("share_token"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("work_lists_user_idx").on(t.userId),
    unique("work_lists_share_token_unique").on(t.shareToken),
  ],
);

// ---- work_list_items (作品リスト内の作品) ----
// tier 配置は持たず、並び順は position だけを持つ。
export const workListItems = sqliteTable(
  "work_list_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    workListId: integer("work_list_id")
      .notNull()
      .references(() => workLists.id, { onDelete: "cascade" }),
    annictWorkId: integer("annict_work_id")
      .notNull()
      .references(() => annictWorks.annictWorkId, { onDelete: "cascade" }),
    position: integer("position").notNull(),
  },
  (t) => [
    unique("work_list_items_list_work_unique").on(t.workListId, t.annictWorkId),
    index("work_list_items_list_idx").on(t.workListId),
  ],
);

// ---- reports (ユーザー通報) ----
// App Store Guideline 1.2 (UGC) 対応。運営がモデレーションするための通報を記録する。
// reporter / reported のどちらのアカウントが削除されても cascade で消える。
export const reports = sqliteTable(
  "reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reportedUserId: text("reported_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    // モデレーション対応状況。更新は scripts/reports.sh（wrangler d1 execute）
    // から行い、API 経路では触らない（認可設計が未決のため）。
    status: text("status", { enum: REPORT_STATUSES }).notNull().default("open"),
    resolutionNote: text("resolution_note"),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("reports_reporter_idx").on(t.reporterId),
    index("reports_reported_user_idx").on(t.reportedUserId),
    index("reports_status_idx").on(t.status),
    check(
      "reports_status_check",
      sql`${t.status} IN ('open', 'resolved', 'dismissed')`,
    ),
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

// ---- analyses (Workers AI 視聴傾向分析のキャッシュ＋生成回数制限, issue #22) ----
// user_id 1 行に「最新の分析結果」と「生成回数カウンタ」を同居させる。
// summary / genres_json / input_hash / work_count / generated_at は生成が
// 完了するまで NULL（レート制限の claim が行だけ先行作成するため）。
// input_hash は分析入力（履歴＋選択ジャンル）のハッシュで、視聴履歴が
// 変わったことを検出してキャッシュを無効化するのに使う。
export const analyses = sqliteTable("analyses", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  summary: text("summary"),
  genresJson: text("genres_json"),
  inputHash: text("input_hash"),
  workCount: integer("work_count"),
  generatedAt: integer("generated_at", { mode: "timestamp" }),
  // 生成回数の計測窓。window_started_at から ANALYSIS_RATE_LIMIT_WINDOW 内に
  // generation_count 回まで生成できる。窓切れ後の claim がカウンタを 1 に
  // リセットする。
  windowStartedAt: integer("window_started_at", {
    mode: "timestamp",
  }).notNull(),
  generationCount: integer("generation_count").notNull(),
});

// ---- recommendations (AI おすすめ生成のキャッシュ＋生成回数制限, issue #335) ----
// analyses と同じく、user_id 1 行に「最新のおすすめ結果」と「生成回数カウンタ」を
// 同居させる。works_json / input_hash / generated_at は生成が完了するまで NULL
// （レート制限の claim が行だけ先行作成するため）。
// input_hash は生成条件（履歴＋選択ジャンル＋現在シーズン＋有効な分析結果の
// 版）の複合ハッシュで、条件が変わったことを検出してキャッシュを無効化する。
export const recommendations = sqliteTable("recommendations", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  worksJson: text("works_json"),
  inputHash: text("input_hash"),
  generatedAt: integer("generated_at", { mode: "timestamp" }),
  windowStartedAt: integer("window_started_at", {
    mode: "timestamp",
  }).notNull(),
  generationCount: integer("generation_count").notNull(),
});

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

// ---- activities (フレンドの活動フィード, issue #265) ----
// ユーザーの「活動」（視聴ステータス更新・推し追加・tier 表の作成/共有）を
// 記録する。GET /me/feed がフレンドの活動を新しい順に返す。
// annict_work_id は作品に関する活動（watch_status / favorite_added /
// kind=character の tier 表）で対象作品を指し、feed 表示で annict_works と
// JOIN する。type ごとの補足情報は meta に JSON で持つ
// （watch_status: {state}、tier_list_*: {kind, season?, title}）。
export const ACTIVITY_TYPES = [
  "watch_status",
  "favorite_added",
  "tier_list_created",
  "tier_list_shared",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const activities = sqliteTable(
  "activities",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type", { enum: ACTIVITY_TYPES }).notNull(),
    annictWorkId: integer("annict_work_id").references(
      () => annictWorks.annictWorkId,
      { onDelete: "cascade" },
    ),
    meta: text("meta"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    index("activities_user_idx").on(t.userId),
    check(
      "activities_type_check",
      sql`${t.type} IN ('watch_status', 'favorite_added', 'tier_list_created', 'tier_list_shared')`,
    ),
  ],
);

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

// ---- Type exports ----
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AnnictWork = typeof annictWorks.$inferSelect;
export type NewAnnictWork = typeof annictWorks.$inferInsert;
export type WatchHistory = typeof watchHistory.$inferSelect;
export type NewWatchHistory = typeof watchHistory.$inferInsert;
export type Favorite = typeof favorites.$inferSelect;
export type NewFavorite = typeof favorites.$inferInsert;
export type Friend = typeof friends.$inferSelect;
export type NewFriend = typeof friends.$inferInsert;
export type UserGenre = typeof userGenres.$inferSelect;
export type TierList = typeof tierLists.$inferSelect;
export type NewTierList = typeof tierLists.$inferInsert;
export type TierListItem = typeof tierListItems.$inferSelect;
export type NewTierListItem = typeof tierListItems.$inferInsert;
export type AnnictCharacter = typeof annictCharacters.$inferSelect;
export type NewAnnictCharacter = typeof annictCharacters.$inferInsert;
export type AnnictWorkCast = typeof annictWorkCasts.$inferSelect;
export type NewAnnictWorkCast = typeof annictWorkCasts.$inferInsert;
export type CharacterTierList = typeof characterTierLists.$inferSelect;
export type NewCharacterTierList = typeof characterTierLists.$inferInsert;
export type CharacterTierListItem = typeof characterTierListItems.$inferSelect;
export type NewCharacterTierListItem =
  typeof characterTierListItems.$inferInsert;
export type CustomTierList = typeof customTierLists.$inferSelect;
export type NewCustomTierList = typeof customTierLists.$inferInsert;
export type CustomTierListItem = typeof customTierListItems.$inferSelect;
export type NewCustomTierListItem = typeof customTierListItems.$inferInsert;
export type WorkList = typeof workLists.$inferSelect;
export type NewWorkList = typeof workLists.$inferInsert;
export type WorkListItem = typeof workListItems.$inferSelect;
export type NewWorkListItem = typeof workListItems.$inferInsert;
export type AnnictToken = typeof annictTokens.$inferSelect;
export type NewAnnictToken = typeof annictTokens.$inferInsert;
export type Analysis = typeof analyses.$inferSelect;
export type NewAnalysis = typeof analyses.$inferInsert;
export type Recommendation = typeof recommendations.$inferSelect;
export type NewRecommendation = typeof recommendations.$inferInsert;
export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;
export type DeletedUser = typeof deletedUsers.$inferSelect;
export type Activity = typeof activities.$inferSelect;
export type NewActivity = typeof activities.$inferInsert;
