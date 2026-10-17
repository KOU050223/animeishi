import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import { annictWorks, annictCharacters, annictWorkCasts } from "@/db/schema";
import type {
  AnnictWork,
  NewAnnictWork,
  AnnictCharacter,
  NewAnnictCharacter,
} from "@/db/schema";

/**
 * worksRepository: 作品カタログ（annict_works / annict_characters /
 * annict_work_casts）のリポジトリ層。
 * これらのテーブルは全ユーザー共有のキャッシュで、行に userId を持たない
 * ためユーザー束縛は持たない。cron（imageFallbackPending）や画像プロキシ（workImage）
 * など認証コンテキスト外からも呼ばれる。
 * ユーザー固有データの操作は各 feature の束縛リポジトリを使うこと。
 */

/** 作品メタ（annict_works）を JOIN で付与するときの共通フィールド。 */
export type AnnictWorkMeta = {
  title: string;
  titleKana: string | null;
  titleEn: string | null;
  seasonName: string | null;
  seasonYear: number | null;
  // Annict 由来の画像 URL（fallback を掛ける前のもの）。互換のため残す。
  imageUrl: string | null;
  // AniList / Jikan で補完済みの URL があればこちら。無ければ null。
  // クライアントは resolvedImageUrl ?? imageUrl の順で表示する。
  resolvedImageUrl: string | null;
  // 'annict' | 'anilist' | 'jikan' | 'none' | null。運用調査用に露出する。
  imageSource: string | null;
  // R2 に取り込み済みの作品画像キー。配信 URL は作品 ID から組み立てる
  // （GET /images/works/<id>）ので、ルート層では使わない。運用調査用。
  imageR2Key: string | null;
};

// annict_works upsert（単発・バルク・ライブラリ同期）で共有する
// onConflictDoUpdate.set。nodeId / malAnimeId は取得できないパスがあるため、
// 新しい値が null のときは既存値を温存する（過去に解決済みの値を消さない）。
// 画像解決結果は「MAL ID が変わったら破棄」して再解決させる。SQLite の
// `is not` は IS DISTINCT FROM 相当（NULL-safe 比較）。新 MAL ID が
// null のとき（未取得）は破棄せず既存値を温存する。
function annictWorkConflictSet() {
  return {
    nodeId: sql`coalesce(excluded.node_id, ${annictWorks.nodeId})`,
    malAnimeId: sql`coalesce(excluded.mal_anime_id, ${annictWorks.malAnimeId})`,
    resolvedImageUrl: sql`case
      when excluded.mal_anime_id is not null
       and excluded.mal_anime_id is not ${annictWorks.malAnimeId}
      then null
      else coalesce(excluded.resolved_image_url, ${annictWorks.resolvedImageUrl})
    end`,
    imageSource: sql`case
      when excluded.mal_anime_id is not null
       and excluded.mal_anime_id is not ${annictWorks.malAnimeId}
      then null
      else coalesce(excluded.image_source, ${annictWorks.imageSource})
    end`,
    resolvedAt: sql`case
      when excluded.mal_anime_id is not null
       and excluded.mal_anime_id is not ${annictWorks.malAnimeId}
      then null
      else coalesce(excluded.resolved_at, ${annictWorks.resolvedAt})
    end`,
    // 最終試行時刻も同じ条件で破棄する（新しい MAL ID の解決を
    // クールダウンなしで改めて試行できるようにするため）。
    imageFallbackAttemptedAt: sql`case
      when excluded.mal_anime_id is not null
       and excluded.mal_anime_id is not ${annictWorks.malAnimeId}
      then null
      else coalesce(excluded.image_fallback_attempted_at, ${annictWorks.imageFallbackAttemptedAt})
    end`,
    title: sql`excluded.title`,
    titleKana: sql`excluded.title_kana`,
    titleEn: sql`excluded.title_en`,
    seasonName: sql`excluded.season_name`,
    seasonYear: sql`excluded.season_year`,
    imageUrl: sql`excluded.image_url`,
    updatedAt: sql`excluded.updated_at`,
  };
}

// 1 行あたりのバインド変数 = カラム数。D1 上限 100 を下回るよう余裕を持たせる。
// annict_works は 17 カラム（MAL ID タイトル検索の試行時刻追加後）なので
// 5 行 × 17 = 85 変数 < 100。これ以上カラムが増える場合はチャンクを絞ること。
const ANNICT_WORK_UPSERT_CHUNK = 5;

// updateResolvedImages の 1 batch あたりの statement 数。更新は行単位の
// statement になるため、往復回数と batch サイズのバランスで区切る。
const RESOLVED_IMAGE_UPDATE_BATCH = 50;

export function worksRepository(db: DrizzleDb) {
  return {
    // ---- Annict Works (キャッシュ) ----
    async getAnnictWorkById(
      annictWorkId: number,
    ): Promise<AnnictWork | undefined> {
      return db.query.annictWorks.findFirst({
        where: eq(annictWorks.annictWorkId, annictWorkId),
      });
    },

    /**
     * 複数の annictWorkId をまとめて取得する。fallback 対象判定などで、
     * 「既に imageSource が設定済みの作品」を弾くために使う。
     * ID 数が多いと D1 の IN 句が肥大化するため、呼び出し側で適度に分割する。
     */
    async getAnnictWorksByIds(annictWorkIds: number[]): Promise<AnnictWork[]> {
      if (annictWorkIds.length === 0) return [];
      return db.query.annictWorks.findMany({
        where: inArray(annictWorks.annictWorkId, annictWorkIds),
      });
    },

    async upsertAnnictWork(data: NewAnnictWork): Promise<void> {
      await db.insert(annictWorks).values(data).onConflictDoUpdate({
        target: annictWorks.annictWorkId,
        set: annictWorkConflictSet(),
      });
    },

    /**
     * annict_works をまとめて upsert する。検索結果（シーズン全件）のように
     * 数百件をまとめて書く経路で、1 件ずつ往復すると D1 レイテンシが積み上がる
     * ため、行チャンクの insert statement を 1 回の db.batch にまとめる。
     * いずれかのチャンクが失敗すると batch 全体が失敗する点に注意
     * （呼び出し側はまとめて失敗として扱う）。
     */
    async upsertAnnictWorks(data: NewAnnictWork[]): Promise<void> {
      const queries: BatchItem<"sqlite">[] = [];
      for (let i = 0; i < data.length; i += ANNICT_WORK_UPSERT_CHUNK) {
        queries.push(
          db
            .insert(annictWorks)
            .values(data.slice(i, i + ANNICT_WORK_UPSERT_CHUNK))
            .onConflictDoUpdate({
              target: annictWorks.annictWorkId,
              set: annictWorkConflictSet(),
            }),
        );
      }
      if (queries.length === 0) return;
      await db.batch(
        queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    },

    /**
     * 画像フォールバック解決後に、resolved_image_url / image_source / resolved_at
     * だけを更新する。read-through / 検索経路の裏で waitUntil から呼ばれる。
     * 作品自体が annict_works に存在しない（先に FK エラーで消えた等）場合は no-op。
     */
    async updateResolvedImage(
      annictWorkId: number,
      data: {
        resolvedImageUrl: string | null;
        imageSource: string;
        resolvedAt: Date;
      },
    ): Promise<void> {
      await db
        .update(annictWorks)
        .set({
          resolvedImageUrl: data.resolvedImageUrl,
          imageSource: data.imageSource,
          resolvedAt: data.resolvedAt,
          // 最終試行時刻をクリア（解決済みになったため）。
          imageFallbackAttemptedAt: null,
        })
        .where(eq(annictWorks.annictWorkId, annictWorkId));
    },

    /**
     * updateResolvedImage のバルク版。検索経路の同期 AniList 解決で
     * まとまった件数を書き込むときに、行ごとの UPDATE を batch にまとめて
     * 往復回数を抑える。一部の batch が失敗しても他の batch には影響しない。
     */
    async updateResolvedImages(
      updates: {
        annictWorkId: number;
        resolvedImageUrl: string | null;
        imageSource: string;
        resolvedAt: Date;
      }[],
    ): Promise<void> {
      const queries: BatchItem<"sqlite">[] = updates.map((u) =>
        db
          .update(annictWorks)
          .set({
            resolvedImageUrl: u.resolvedImageUrl,
            imageSource: u.imageSource,
            resolvedAt: u.resolvedAt,
            // 最終試行時刻をクリア（解決済みになったため）。
            imageFallbackAttemptedAt: null,
          })
          .where(eq(annictWorks.annictWorkId, u.annictWorkId)),
      );
      for (let i = 0; i < queries.length; i += RESOLVED_IMAGE_UPDATE_BATCH) {
        const chunk = queries.slice(i, i + RESOLVED_IMAGE_UPDATE_BATCH);
        await db.batch(
          chunk as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
        );
      }
    },

    /**
     * 画像フォールバック解決を試行する作品に最終試行時刻
     * （image_fallback_attempted_at）を立てる。クールダウン期間内の
     * 叩き直しを弾くためのもので、image_source が既に立った（=解決済み）行には
     * 立てない。D1 のバインド上限（100 変数）対策で 90 件ずつ分割する。
     */
    async markImageFallbackAttempted(
      annictWorkIds: number[],
      at: Date,
    ): Promise<void> {
      for (let i = 0; i < annictWorkIds.length; i += 90) {
        const chunk = annictWorkIds.slice(i, i + 90);
        await db
          .update(annictWorks)
          .set({ imageFallbackAttemptedAt: at })
          .where(
            and(
              inArray(annictWorks.annictWorkId, chunk),
              isNull(annictWorks.imageSource),
            ),
          );
      }
    },

    /**
     * cron で画像フォールバック解決を試行する候補を少量取得する。
     * 最近 Annict read-through / search で書き込まれた作品を優先するため updated_at 降順
     * （検索経路は内容が変わらない作品を書き直さないので、厳密な「最終閲覧順」ではない）。
     * attemptedStaleBefore 以降に試行済みの作品（クールダウン生存中）は除外する。
     */
    async getPendingImageFallbackWorks(
      limit: number,
      attemptedStaleBefore: Date,
    ): Promise<{ annictWorkId: number; malAnimeId: number }[]> {
      const safeLimit = Math.max(0, Math.min(Math.trunc(limit), 100));
      if (safeLimit === 0) return [];

      const rows = await db
        .select({
          annictWorkId: annictWorks.annictWorkId,
          malAnimeId: annictWorks.malAnimeId,
        })
        .from(annictWorks)
        .where(
          and(
            sql`
          ${annictWorks.imageSource} is null
          and ${annictWorks.malAnimeId} is not null
          and (
            ${annictWorks.imageUrl} is null
            or trim(${annictWorks.imageUrl}) = ''
            or lower(trim(${annictWorks.imageUrl})) like 'http:%'
            or lower(${annictWorks.imageUrl}) like '%pbs.twimg.com%'
            or lower(${annictWorks.imageUrl}) like '%twimg.com%'
            or lower(${annictWorks.imageUrl}) like '%graph.facebook.com%'
            or lower(${annictWorks.imageUrl}) like '%fbcdn.net%'
          )
        `,
            or(
              isNull(annictWorks.imageFallbackAttemptedAt),
              lt(annictWorks.imageFallbackAttemptedAt, attemptedStaleBefore),
            ),
          ),
        )
        .orderBy(desc(annictWorks.updatedAt))
        .limit(safeLimit);

      return rows.flatMap((row) =>
        row.malAnimeId == null
          ? []
          : [{ annictWorkId: row.annictWorkId, malAnimeId: row.malAnimeId }],
      );
    },

    // ---- Annict Characters（キャラクター名簿キャッシュ） ----
    /**
     * 複数の annictCharacterId をまとめて取得する。
     * tier 表保存時の存在チェック（FK 違反を 400 に変える事前検証）に使う。
     */
    async getAnnictCharactersByIds(
      annictCharacterIds: number[],
    ): Promise<AnnictCharacter[]> {
      if (annictCharacterIds.length === 0) return [];
      return db.query.annictCharacters.findMany({
        where: inArray(annictCharacters.annictCharacterId, annictCharacterIds),
      });
    },

    /**
     * annict_characters をまとめて upsert する。
     * imageUrl は「今回解決できた値があるときだけ」更新する
     * （AniList 名寄せが取れなかった回で既存の解決済み URL を消さない）。
     * nameKana/nameEn も同じ方針で、Annict が一時的に null を返した
     * 取得回で既存の値を消さない（annictWorkConflictSet と同じ温存方針）。
     * 6 カラム × 15 行 = 90 変数で D1 のバインド上限を下回るようチャンクする。
     */
    async upsertAnnictCharacters(data: NewAnnictCharacter[]): Promise<void> {
      const CHUNK = 15;
      const queries: BatchItem<"sqlite">[] = [];
      for (let i = 0; i < data.length; i += CHUNK) {
        queries.push(
          db
            .insert(annictCharacters)
            .values(data.slice(i, i + CHUNK))
            .onConflictDoUpdate({
              target: annictCharacters.annictCharacterId,
              set: {
                name: sql`excluded.name`,
                nameKana: sql`coalesce(excluded.name_kana, ${annictCharacters.nameKana})`,
                nameEn: sql`coalesce(excluded.name_en, ${annictCharacters.nameEn})`,
                imageUrl: sql`coalesce(excluded.image_url, ${annictCharacters.imageUrl})`,
                updatedAt: sql`excluded.updated_at`,
              },
            }),
        );
      }
      if (queries.length === 0) return;
      await db.batch(
        queries as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]],
      );
    },

    /**
     * 作品→キャラクターの所属（annict_work_casts）をまとめて upsert する。
     * tier 表保存時に「その作品のキャストか」を検証するためのカタログ。
     * 同じキャラが複数キャスト枠を持つ場合は小さい sortNumber を残す。
     * 3 カラム × 30 行 = 90 変数で D1 のバインド上限を下回るようチャンクする。
     */
    async upsertAnnictWorkCasts(
      annictWorkId: number,
      casts: { annictCharacterId: number; sortNumber: number }[],
    ): Promise<void> {
      const CHUNK = 30;
      for (let i = 0; i < casts.length; i += CHUNK) {
        await db
          .insert(annictWorkCasts)
          .values(
            casts.slice(i, i + CHUNK).map((cast) => ({
              annictWorkId,
              annictCharacterId: cast.annictCharacterId,
              sortNumber: cast.sortNumber,
            })),
          )
          .onConflictDoUpdate({
            target: [
              annictWorkCasts.annictWorkId,
              annictWorkCasts.annictCharacterId,
            ],
            set: {
              sortNumber: sql`min(${annictWorkCasts.sortNumber}, excluded.sort_number)`,
            },
          });
      }
    },

    /**
     * その作品のキャストとして記録されている annictCharacterId の集合。
     * tier 表保存時の所属検証に使う（annict_characters の存在チェックだけでは
     * 別作品のキャラクターを弾けない）。
     */
    async getAnnictWorkCastIds(annictWorkId: number): Promise<Set<number>> {
      const rows = await db
        .select({ id: annictWorkCasts.annictCharacterId })
        .from(annictWorkCasts)
        .where(eq(annictWorkCasts.annictWorkId, annictWorkId));
      return new Set(rows.map((r) => r.id));
    },

    /**
     * 作品画像の R2 キーを確定する（取り込み成功時）。
     * null を渡すとキーを消去する（ソース消失時の掃除用）。
     * attemptedAt も同時に立ててクールダウン対象にする。
     */
    async updateImageR2Key(
      annictWorkId: number,
      key: string | null,
      attemptedAt: Date,
    ): Promise<void> {
      await db
        .update(annictWorks)
        .set({ imageR2Key: key, imageR2AttemptedAt: attemptedAt })
        .where(eq(annictWorks.annictWorkId, annictWorkId));
    },

    /**
     * 作品画像の取り込みが全候補で失敗した時刻を立てる。
     * 画像プロキシ（serveWorkImage）がクールダウン判定に使う。
     */
    async markImageR2Attempted(annictWorkId: number, at: Date): Promise<void> {
      await db
        .update(annictWorks)
        .set({ imageR2AttemptedAt: at })
        .where(eq(annictWorks.annictWorkId, annictWorkId));
    },

    // ---- MAL ID のタイトル検索（issue #223） ----
    /**
     * MAL ID を持たず、タイトル検索のクールダウンが明けた作品を取得する。
     * 最近書き込まれた（＝検索・表示された）作品を優先するため updated_at 降順。
     */
    async getMalSearchTargets(
      limit: number,
      attemptedStaleBefore: Date,
    ): Promise<
      {
        annictWorkId: number;
        title: string;
        titleEn: string | null;
        seasonYear: number | null;
      }[]
    > {
      const safeLimit = Math.max(0, Math.min(Math.trunc(limit), 50));
      if (safeLimit === 0) return [];
      return db
        .select({
          annictWorkId: annictWorks.annictWorkId,
          title: annictWorks.title,
          titleEn: annictWorks.titleEn,
          seasonYear: annictWorks.seasonYear,
        })
        .from(annictWorks)
        .where(
          and(
            isNull(annictWorks.malAnimeId),
            sql`trim(${annictWorks.title}) <> ''`,
            or(
              isNull(annictWorks.malSearchAttemptedAt),
              lt(annictWorks.malSearchAttemptedAt, attemptedStaleBefore),
            ),
          ),
        )
        .orderBy(desc(annictWorks.updatedAt))
        .limit(safeLimit);
    },

    /**
     * タイトル検索で見つかった MAL ID を書き戻す。画像補完 cron と画像プロキシの
     * クールダウンもクリアし、新しい MAL ID ですぐに補完を試せるようにする。
     * 検索中に Annict 側から MAL ID が入った行は上書きしない（mal_anime_id is null 条件）。
     */
    async updateMalAnimeIdFromSearch(
      annictWorkId: number,
      malAnimeId: number,
      at: Date,
    ): Promise<void> {
      await db
        .update(annictWorks)
        .set({
          malAnimeId,
          malSearchAttemptedAt: at,
          imageFallbackAttemptedAt: null,
          imageR2AttemptedAt: null,
        })
        .where(
          and(
            eq(annictWorks.annictWorkId, annictWorkId),
            isNull(annictWorks.malAnimeId),
          ),
        );
    },

    /** タイトル検索で見つからなかった作品に試行時刻を立てる（90 件ずつ分割）。 */
    async markMalSearchAttempted(
      annictWorkIds: number[],
      at: Date,
    ): Promise<void> {
      for (let i = 0; i < annictWorkIds.length; i += 90) {
        await db
          .update(annictWorks)
          .set({ malSearchAttemptedAt: at })
          .where(
            inArray(annictWorks.annictWorkId, annictWorkIds.slice(i, i + 90)),
          );
      }
    },
  };
}

export type WorksRepository = ReturnType<typeof worksRepository>;
