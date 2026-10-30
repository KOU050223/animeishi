import { and, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { DrizzleDb } from "@/db/client";
import { annictWorks, annictCharacters, annictWorkCasts } from "@/db/schema";
import { IMAGE_SOURCE_BLOCKED } from "@/lib/annict/imageFallback";
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
  // Kitsu で補完済みの URL があればこちら。無ければ null。
  // クライアントは resolvedImageUrl ?? imageUrl の順で表示する。
  resolvedImageUrl: string | null;
  // 'kitsu' | 'none' | null（'anilist' / 'jikan' は過去の供給元で
  // 既存行にのみ残る値）。運用調査用に露出する。
  imageSource: string | null;
  // R2 に取り込み済みの作品画像キー。配信 URL は作品 ID から組み立てる
  // （GET /images/works/<id>）ので、ルート層では使わない。運用調査用。
  imageR2Key: string | null;
  // Annict Work.watchersCount（作品の人気指標）。null は未取得。
  watchersCount: number | null;
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
    // 'blocked'（削除依頼で画像を消した作品。issue #241）は MAL ID が
    // 変わっても外さない。外すと補完の対象に戻り、消した画像を取り直しうる。
    // バインド変数を増やさないよう（ANNICT_WORK_UPSERT_CHUNK の前提）、
    // IMAGE_SOURCE_BLOCKED と同じ値をリテラルで書く。
    imageSource: sql`case
      when excluded.mal_anime_id is not null
       and excluded.mal_anime_id is not ${annictWorks.malAnimeId}
       and ${annictWorks.imageSource} is not 'blocked'
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
    // MAL ID のタイトル検索（issue #223）の試行時刻は、検索の材料である
    // タイトル・英題・放送年のどれかが変わったら破棄する（改題後の正式タイトルで
    // すぐに検索し直せるように）。SQLite の `is not` は NULL-safe 比較。
    // kitsu_anime_id（issue #227）は Annict の upsert では更新されないため、
    // 他カラムと同じく新しい値が null のときは既存値を温存する。
    kitsuAnimeId: sql`coalesce(excluded.kitsu_anime_id, ${annictWorks.kitsuAnimeId})`,
    malSearchAttemptedAt: sql`case
      when excluded.title is not ${annictWorks.title}
        or excluded.title_en is not ${annictWorks.titleEn}
        or excluded.season_year is not ${annictWorks.seasonYear}
      then null
      else ${annictWorks.malSearchAttemptedAt}
    end`,
    title: sql`excluded.title`,
    titleKana: sql`excluded.title_kana`,
    titleEn: sql`excluded.title_en`,
    seasonName: sql`excluded.season_name`,
    seasonYear: sql`excluded.season_year`,
    imageUrl: sql`excluded.image_url`,
    // watchersCount は libraryEntries / Node ID 解決の経路でだけ取得する。
    // 取らない経路（検索・キャスト一覧）の upsert が null を投げてきても
    // 既存値を消さないよう温存する。
    watchersCount: sql`coalesce(excluded.watchers_count, ${annictWorks.watchersCount})`,
    // ジャンル・タグは名寄せキー（mal_anime_id / kitsu_anime_id）由来の値なので、
    // キーが変わった行は破棄して genre_fetch cron に取り直させる
    // （旧キーのジャンルで絞り込まれ続けないようにする）。
    genres: sql`case
      when (excluded.mal_anime_id is not null
        and excluded.mal_anime_id is not ${annictWorks.malAnimeId})
        or (excluded.kitsu_anime_id is not null
        and excluded.kitsu_anime_id is not ${annictWorks.kitsuAnimeId})
      then null
      else ${annictWorks.genres}
    end`,
    genresFetchedAt: sql`case
      when (excluded.mal_anime_id is not null
        and excluded.mal_anime_id is not ${annictWorks.malAnimeId})
        or (excluded.kitsu_anime_id is not null
        and excluded.kitsu_anime_id is not ${annictWorks.kitsuAnimeId})
      then null
      else ${annictWorks.genresFetchedAt}
    end`,
    genresAttemptedAt: sql`case
      when (excluded.mal_anime_id is not null
        and excluded.mal_anime_id is not ${annictWorks.malAnimeId})
        or (excluded.kitsu_anime_id is not null
        and excluded.kitsu_anime_id is not ${annictWorks.kitsuAnimeId})
      then null
      else ${annictWorks.genresAttemptedAt}
    end`,
    updatedAt: sql`excluded.updated_at`,
  };
}

/**
 * upsert しようとしている作品メタが、キャッシュ済みの行と同じか。
 * nodeId / malAnimeId は upsert 側が「新しい値が null なら既存値を温存」する
 * （annictWorkConflictSet）ため、新しい値が null のときは一致扱いにする。
 * 作品検索（attachResolvedImages）とライブラリ同期（syncMyLibraryFromAnnict）
 * の両方が、内容の同じ作品を書き直さない判定に使う（D1 書き込み削減）。
 */
export function isUnchangedCachedWork(
  row: Pick<
    NewAnnictWork,
    | "nodeId"
    | "malAnimeId"
    | "title"
    | "titleKana"
    | "titleEn"
    | "seasonName"
    | "seasonYear"
    | "imageUrl"
    | "watchersCount"
  >,
  cached: AnnictWork | undefined,
): boolean {
  if (!cached) return false;
  return (
    (row.nodeId == null || row.nodeId === cached.nodeId) &&
    (row.malAnimeId == null || row.malAnimeId === cached.malAnimeId) &&
    row.title === cached.title &&
    row.titleKana === cached.titleKana &&
    row.titleEn === cached.titleEn &&
    row.seasonName === cached.seasonName &&
    row.seasonYear === cached.seasonYear &&
    row.imageUrl === cached.imageUrl &&
    (row.watchersCount == null || row.watchersCount === cached.watchersCount)
  );
}

// image_source が 'blocked'（削除依頼で画像を消した作品。issue #241）でない。
// 補完結果の書き込みに掛け、消した画像の URL を書き戻さないようにする。
function notBlockedImageSource() {
  return or(
    isNull(annictWorks.imageSource),
    ne(annictWorks.imageSource, IMAGE_SOURCE_BLOCKED),
  );
}

// 1 行あたりのバインド変数 = カラム数。D1 上限 100 を下回るよう余裕を持たせる。
// annict_works は 22 カラム（genres / genres_fetched_at / genres_attempted_at
// 追加後）なので 4 行 × 22 = 88 変数 < 100。これ以上カラムが増える場合は
// チャンクを絞ること。
const ANNICT_WORK_UPSERT_CHUNK = 4;

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
     * 'blocked'（削除依頼で画像を消した作品）の行も書き換えない。解決中に
     * 削除スクリプトが走っても、消した画像の URL を書き戻さないため。
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
        .where(
          and(
            eq(annictWorks.annictWorkId, annictWorkId),
            notBlockedImageSource(),
          ),
        );
    },

    /**
     * updateResolvedImage のバルク版。検索経路の同期 Kitsu 解決で
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
          .where(
            and(
              eq(annictWorks.annictWorkId, u.annictWorkId),
              notBlockedImageSource(),
            ),
          ),
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
     * 叩き直しを弾くためのもの。image_source が供給元確定済みの行には
     * 立てないが、'none'（ネガキャッシュ。TTL 再解決の対象）と null
     * （未解決）の行には立てる。D1 のバインド上限（100 変数）対策で
     * 90 件ずつ分割する。
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
              or(
                isNull(annictWorks.imageSource),
                eq(annictWorks.imageSource, "none"),
              ),
            ),
          );
      }
    },

    /**
     * cron で画像フォールバック解決を試行する候補を少量取得する。
     * 最近 Annict read-through / search で書き込まれた作品を優先するため updated_at 降順
     * （検索経路は内容が変わらない作品を書き直さないので、厳密な「最終閲覧順」ではない）。
     * attemptedStaleBefore 以降に試行済みの作品（クールダウン生存中）は除外する。
     *
     * 対象は「未解決（image_source is null）」の作品に加えて、
     * 「'none'（Kitsu にも無いと確定）だが確定時刻 resolved_at が
     * noneResolvedStaleBefore より古い」作品。'none' のままだと二度と
     * 拾えないため、TTL で再解決して将来 Kitsu に登録された画像を救う。
     * 'blocked'（削除依頼で画像を消した作品。issue #241）はどちらにも
     * 当たらないので対象にならない。
     */
    async getPendingImageFallbackWorks(
      limit: number,
      attemptedStaleBefore: Date,
      noneResolvedStaleBefore: Date,
    ): Promise<
      {
        annictWorkId: number;
        malAnimeId: number | null;
        kitsuAnimeId: number | null;
      }[]
    > {
      const safeLimit = Math.max(0, Math.min(Math.trunc(limit), 100));
      if (safeLimit === 0) return [];

      const rows = await db
        .select({
          annictWorkId: annictWorks.annictWorkId,
          malAnimeId: annictWorks.malAnimeId,
          kitsuAnimeId: annictWorks.kitsuAnimeId,
        })
        .from(annictWorks)
        .where(
          and(
            sql`
          (${annictWorks.malAnimeId} is not null
           or ${annictWorks.kitsuAnimeId} is not null)
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
              isNull(annictWorks.imageSource),
              and(
                eq(annictWorks.imageSource, "none"),
                or(
                  isNull(annictWorks.resolvedAt),
                  lt(annictWorks.resolvedAt, noneResolvedStaleBefore),
                ),
              ),
            ),
            or(
              isNull(annictWorks.imageFallbackAttemptedAt),
              lt(annictWorks.imageFallbackAttemptedAt, attemptedStaleBefore),
            ),
          ),
        )
        .orderBy(desc(annictWorks.updatedAt))
        .limit(safeLimit);

      return rows.flatMap((row) =>
        row.malAnimeId == null && row.kitsuAnimeId == null
          ? []
          : [
              {
                annictWorkId: row.annictWorkId,
                malAnimeId: row.malAnimeId,
                kitsuAnimeId: row.kitsuAnimeId,
              },
            ],
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
     * （Kitsu 名寄せが取れなかった回で既存の解決済み URL を消さない）。
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
     * 作品画像の R2 キーを無条件に書き換える。画像プロキシはキーの消去
     * （null。ソース消失時の掃除用）にだけ使い、取り込み成功時のキーの記録は
     * linkImageR2Key で行う。
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
     * 取り込んだ作品画像の R2 キーを記録する。image_source が取り込み開始時の値
     * （expectedImageSource）から変わっていたら書かずに false を返す。
     * 取り込み中に削除スクリプトが行を 'blocked' にした場合（issue #241）に、
     * 削除済みの MAL 画像のキーを書き戻さないため。SQLite の `is` は NULL-safe 比較。
     */
    async linkImageR2Key(
      annictWorkId: number,
      key: string,
      attemptedAt: Date,
      expectedImageSource: string | null,
    ): Promise<boolean> {
      const updated = await db
        .update(annictWorks)
        .set({ imageR2Key: key, imageR2AttemptedAt: attemptedAt })
        .where(
          and(
            eq(annictWorks.annictWorkId, annictWorkId),
            sql`${annictWorks.imageSource} is ${expectedImageSource}`,
          ),
        )
        .returning({ annictWorkId: annictWorks.annictWorkId });
      return updated.length > 0;
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
     * 一致した Kitsu 作品の ID もあわせて保持する（Kitsu 側の名寄せ結果の記録）。
     * ジャンル・タグは名寄せキー由来の値なので、キーが入り直した行は破棄して
     * genre_fetch cron に取り直させる。
     */
    async updateMalAnimeIdFromSearch(
      annictWorkId: number,
      malAnimeId: number,
      kitsuAnimeId: number | null,
      at: Date,
    ): Promise<void> {
      await db
        .update(annictWorks)
        .set({
          malAnimeId,
          kitsuAnimeId,
          malSearchAttemptedAt: at,
          imageFallbackAttemptedAt: null,
          imageR2AttemptedAt: null,
          genres: null,
          genresFetchedAt: null,
          genresAttemptedAt: null,
        })
        .where(
          and(
            eq(annictWorks.annictWorkId, annictWorkId),
            isNull(annictWorks.malAnimeId),
          ),
        );
    },

    /**
     * タイトル検索で一致したが MAL mapping を持たない作品に、Kitsu 側の
     * 作品 ID を書き戻す（issue #227）。画像プロキシが MAL ID の代わりに
     * この ID から Kitsu のポスター画像を引くためのキー。既存のクールダウンは
     * クリアし、新しいキーですぐに補完を試せるようにする。
     * 検索中に Annict 側から MAL ID が入った行は上書きしない
     * （mal_anime_id is null 条件）。
     */
    async updateKitsuAnimeIdFromSearch(
      annictWorkId: number,
      kitsuAnimeId: number,
      at: Date,
    ): Promise<void> {
      await db
        .update(annictWorks)
        .set({
          kitsuAnimeId,
          malSearchAttemptedAt: at,
          imageFallbackAttemptedAt: null,
          imageR2AttemptedAt: null,
          // ジャンル・タグは名寄せキー由来の値なので、キーが入り直した行は
          // 破棄して genre_fetch cron に取り直させる。
          genres: null,
          genresFetchedAt: null,
          genresAttemptedAt: null,
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

    // ---- ジャンル・タグの取り込み（issue #346） ----
    /**
     * cron でジャンル取得を試行する作品を少量取得する。
     * 最近書き込まれた（＝検索・表示された）作品を優先するため updated_at 降順。
     * 名寄せキー（mal_anime_id か kitsu_anime_id）の無い作品はそもそも
     * 引けないため対象外（キーが後から埋まったときに拾われる）。
     *
     * 対象は「未取得（genres is null）でクールダウン切れ」の作品に加えて、
     * 「空配列（取得済みだが供給元にも無い）で genres_fetched_at が
     * emptyGenresStaleBefore より古い」作品。後から Kitsu にカテゴリが
     * 登録される作品を救うための TTL 再取得（image fallback の 'none' と
     * 同じ発想）。クールダウンは genres_attempted_at で判定する
     * （fetched は「最後の成功」、attempted は「最後の試行」なので、
     * TTL 再取得の失敗が再試行を TTL 分先送りしない）。
     */
    async getPendingGenreWorks(
      limit: number,
      attemptedStaleBefore: Date,
      emptyGenresStaleBefore: Date,
    ): Promise<
      {
        annictWorkId: number;
        malAnimeId: number | null;
        kitsuAnimeId: number | null;
      }[]
    > {
      const safeLimit = Math.max(0, Math.min(Math.trunc(limit), 100));
      if (safeLimit === 0) return [];

      return db
        .select({
          annictWorkId: annictWorks.annictWorkId,
          malAnimeId: annictWorks.malAnimeId,
          kitsuAnimeId: annictWorks.kitsuAnimeId,
        })
        .from(annictWorks)
        .where(
          and(
            or(
              sql`${annictWorks.malAnimeId} is not null`,
              sql`${annictWorks.kitsuAnimeId} is not null`,
            ),
            or(
              and(
                isNull(annictWorks.genres),
                or(
                  isNull(annictWorks.genresAttemptedAt),
                  lt(annictWorks.genresAttemptedAt, attemptedStaleBefore),
                ),
              ),
              and(
                sql`${annictWorks.genres} = '[]'`,
                or(
                  isNull(annictWorks.genresAttemptedAt),
                  lt(annictWorks.genresAttemptedAt, attemptedStaleBefore),
                ),
                or(
                  isNull(annictWorks.genresFetchedAt),
                  lt(annictWorks.genresFetchedAt, emptyGenresStaleBefore),
                ),
              ),
            ),
          ),
        )
        .orderBy(desc(annictWorks.updatedAt))
        .limit(safeLimit);
    },

    /**
     * 取り込んだジャンル・タグを書き込む。取得成功時刻も立てる。
     * 解決した行だけを呼び出し側が渡す（失敗行は markGenreFetchAttempted）。
     */
    async updateWorkGenres(
      annictWorkId: number,
      genres: string[],
      at: Date,
    ): Promise<void> {
      await db
        .update(annictWorks)
        .set({ genres, genresFetchedAt: at })
        .where(eq(annictWorks.annictWorkId, annictWorkId));
    },

    /** ジャンル取得に失敗した作品に試行時刻を立てる（90 件ずつ分割）。 */
    async markGenreFetchAttempted(
      annictWorkIds: number[],
      at: Date,
    ): Promise<void> {
      for (let i = 0; i < annictWorkIds.length; i += 90) {
        await db
          .update(annictWorks)
          .set({ genresAttemptedAt: at })
          .where(
            inArray(annictWorks.annictWorkId, annictWorkIds.slice(i, i + 90)),
          );
      }
    },
  };
}

export type WorksRepository = ReturnType<typeof worksRepository>;
