import { sql } from "drizzle-orm";
import {
  integer,
  sqliteTable,
  text,
  index,
  primaryKey,
} from "drizzle-orm/sqlite-core";

// ---- annict_works (Annict 作品キャッシュ) ----
export const annictWorks = sqliteTable(
  "annict_works",
  {
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
  },
  (t) => [
    // cron の未解決行の棚卸しクエリ（works/repository.ts の getMalSearchTargets /
    // getPendingImageFallbackWorks / getPendingGenreWorks）が、対象の部分集合
    // だけを updated_at 降順にたどって止まれるようにする部分インデックス。
    // インデックスが無いと毎回テーブル全行を読んで並び替え、D1 の rows_read
    // 無料枠を圧迫する（issue #704）。
    index("annict_works_pending_mal_idx")
      .on(t.updatedAt)
      .where(sql`${t.malAnimeId} is null`),
    index("annict_works_pending_image_idx")
      .on(t.updatedAt)
      .where(sql`${t.imageSource} is null or ${t.imageSource} = 'none'`),
    index("annict_works_pending_genre_idx")
      .on(t.updatedAt)
      .where(sql`${t.genres} is null or ${t.genres} = '[]'`),
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

export type AnnictWork = typeof annictWorks.$inferSelect;
export type NewAnnictWork = typeof annictWorks.$inferInsert;
export type AnnictCharacter = typeof annictCharacters.$inferSelect;
export type NewAnnictCharacter = typeof annictCharacters.$inferInsert;
