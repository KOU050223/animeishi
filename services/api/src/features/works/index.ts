import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  annictWorkIdParamSchema,
  worksSearchQuerySchema,
} from "@/schema/validators";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// features/watch-history/index.ts のコメント参照）。
import {
  currentAnnictSeason,
  fetchAnnictWorkCasts,
  searchAnnictWorksBySeason,
  searchAnnictWorksByTitle,
} from "@/lib/annict/client";
import type { AnnictLibraryEntry } from "@/lib/annict/client";
import {
  readSeasonWorksCache,
  writeSeasonWorksCache,
} from "@/lib/annict/seasonWorksCache";
import { requireAnnictToken } from "@/lib/annict/middleware";
import {
  isPlaceholderImageUrl,
  resolveImagesViaAnilist,
} from "@/lib/annict/imageFallback";
import {
  fetchAnilistCharacters,
  matchCharacterImages,
} from "@/lib/annict/characterImageFallback";
import { hostedWorkImageUrl } from "@/lib/annict/imagePrefetch";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";

function getBindings(c: Context): AuthEnv["Bindings"] & {
  DB: D1Database;
} {
  return c.env as AuthEnv["Bindings"] & {
    DB: D1Database;
  };
}

// 作品検索は Annict searchWorks をプロキシする。Animeishi は作品マスタを持たず、
// 検索のたびに Annict へ問い合わせる（docs/05 PR5）。視聴ステータスは含まない。
//
// title があればタイトル検索。無ければ season（明示 or 今期既定）でシーズン検索し、
// 検索画面の初期表示（今期アニメ）を返す。どちらも視聴者数の多い順ではないが、
// シーズン検索は WATCHERS_COUNT 降順で「人気の今期アニメ」を上位に出す。
//
// シーズン検索はサーバー側で全ページ取得する（issue #163: 先頭 50 件打ち切りの
// 解消）。全件結果は全ユーザー共通データなのでシーズン単位で Cache API に
// キャッシュし、直列の Annict 往復を繰り返さない（issue #173 の初回遅延も緩和）。
const works = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get(
    "/search",
    requireAnnictToken,
    zValidator("query", worksSearchQuerySchema),
    async (c) => {
      const { title, season, after } = c.req.valid("query");
      // 空文字 title（?title=）は未指定扱いにしてシーズン検索へ流す。
      const trimmedTitle = title?.trim();

      const result = trimmedTitle
        ? await searchAnnictWorksByTitle(
            c.var.annictToken,
            trimmedTitle,
            after ?? null,
          )
        : await searchSeasonWorks(
            c.var.annictToken,
            season ?? currentAnnictSeason(),
            after ?? null,
          );

      // 検索結果に resolvedImageUrl（キャッシュ済みの AniList / Jikan 由来 URL）を
      // 添えて返す。imageUrl 自体は上書きしない — 「Annict 画像を優先し、無ければ
      // resolved に落とす」の判定はクライアントの表示ポリシーであってサーバの
      // 責務ではない（クライアントの pickImageUrl で解決する。issue #86）。
      // 未解決 + Annict 画像が placeholder な作品は、まとめて取れる AniList
      // バッチだけここで同期解決する。取れなかった分は annict_works に upsert
      // 済みの行として残り、cron が直接解決する（issue #127: Queue 廃止）。
      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);
      const enriched = await attachResolvedImages(adb, result.works, c.req.url);

      return c.json({ ...result, works: enriched }, 200);
    },
  )
  // 作品に紐づくキャラクター一覧（キャラクター tier 表の対象名簿。issue #169）。
  // Annict GraphQL の Character 型は画像を持たないため、キャラクター画像は
  // work.malAnimeId 経由で AniList Media.characters を取り、正規化名の
  // 名寄せで補完する（characterImageFallback.ts）。取れないキャラは
  // imageUrl: null で返す（best-effort で応答自体は壊さない）。
  .get(
    "/:annictWorkId/characters",
    requireAnnictToken,
    zValidator("param", annictWorkIdParamSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const result = await fetchAnnictWorkCasts(
        c.var.annictToken,
        annictWorkId,
      );
      if (!result) return c.json({ error: "Work not found" }, 404);
      const { work, characters } = result;

      const db = createDb(getBindings(c).DB);
      const adb = authorizedDb(db, c.var.clerkUserId);

      // キャラクター tier 表（character_tier_lists）の FK 先となる作品行と
      // キャラクター行をここでキャッシュする。作品自体は /works/search の
      // read-through でキャッシュ済みのことが多いが、キャラ一覧が保存の
      // 前提を満たすようこの経路でも upsert する。
      if (work.title?.trim()) {
        try {
          await adb.upsertAnnictWork({
            annictWorkId: work.annictWorkId,
            nodeId: work.nodeId,
            malAnimeId: work.malAnimeId,
            title: work.title,
            titleKana: work.titleKana,
            titleEn: work.titleEn,
            seasonName: work.seasonName,
            seasonYear: work.seasonYear,
            imageUrl: work.imageUrl,
            updatedAt: new Date(),
          });
        } catch (err) {
          // キャッシュ失敗は一覧応答を壊さない（保存時の 400 で検知される）。
          console.error(
            JSON.stringify({
              level: "warn",
              event: "work_cache_upsert_failed",
              annictWorkId: work.annictWorkId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }

      // 既存キャッシュの imageUrl を拾い、未取得分だけ AniList 名寄せで補完する。
      const cachedCharacters = await adb.getAnnictCharactersByIds(
        characters.map((ch) => ch.annictCharacterId),
      );
      const cachedImageById = new Map(
        cachedCharacters
          .filter((ch) => ch.imageUrl)
          .map((ch) => [ch.annictCharacterId, ch.imageUrl as string]),
      );

      // 全キャラクターの画像がキャッシュ済みなら AniList を呼ばない
      // （キャッシュ済みでも毎回直列で往復すると応答が遅延する）。
      const resolvedImages = new Map<number, string>();
      const hasUnresolved = characters.some(
        (ch) => !cachedImageById.has(ch.annictCharacterId),
      );
      if (work.malAnimeId != null && hasUnresolved) {
        try {
          const anilistCharacters = await fetchAnilistCharacters(
            work.malAnimeId,
          );
          for (const [id, url] of matchCharacterImages(
            characters,
            anilistCharacters,
          )) {
            resolvedImages.set(id, url);
          }
        } catch (err) {
          console.error(
            JSON.stringify({
              level: "warn",
              event: "character_image_resolve_failed",
              annictWorkId: work.annictWorkId,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      }

      const now = new Date();
      try {
        await adb.upsertAnnictCharacters(
          characters.map((ch) => ({
            annictCharacterId: ch.annictCharacterId,
            name: ch.name,
            nameKana: ch.nameKana,
            nameEn: ch.nameEn,
            // 今回解決できた値だけ書き込み、取れなかった行は既存値を温存する
            // （upsertAnnictCharacters 側で coalesce する）。
            imageUrl: resolvedImages.get(ch.annictCharacterId) ?? null,
            updatedAt: now,
          })),
        );
        // 作品→キャラクターの所属もキャッシュする。tier 表保存時に
        // 「その作品のキャストか」を検証するカタログ（annict_characters は
        // 作品を跨ぐ共有カタログなので所属は別テーブルで持つ）。
        await adb.upsertAnnictWorkCasts(
          work.annictWorkId,
          characters.map((ch) => ({
            annictCharacterId: ch.annictCharacterId,
            sortNumber: ch.sortNumber,
          })),
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "warn",
            event: "character_cache_upsert_failed",
            annictWorkId: work.annictWorkId,
            count: characters.length,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }

      return c.json(
        {
          work,
          characters: characters.map((ch) => ({
            ...ch,
            imageUrl:
              resolvedImages.get(ch.annictCharacterId) ??
              cachedImageById.get(ch.annictCharacterId) ??
              null,
          })),
        },
        200,
      );
    },
  );

/**
 * シーズン検索の入口。1 ページ目（after 無し）はシーズン単位の Cache API
 * キャッシュを参照し、ミス時のみ Annict へ全ページ取得しにいく。
 * after 指定はクライアントの追い読み（上限到達時の継続取得）なので
 * キャッシュを介さず Annict を叩く。取得が打ち切られた（hasNextPage=true の）
 * 部分結果は「全件」として共有できないためキャッシュしない。
 */
async function searchSeasonWorks(
  annictToken: string,
  season: string,
  after: string | null,
): Promise<{
  works: AnnictLibraryEntry[];
  hasNextPage: boolean;
  endCursor: string | null;
}> {
  if (after) {
    return searchAnnictWorksBySeason(annictToken, season, after);
  }
  const cached = await readSeasonWorksCache(season);
  if (cached) {
    return { works: cached, hasNextPage: false, endCursor: null };
  }
  const result = await searchAnnictWorksBySeason(annictToken, season, null);
  if (!result.hasNextPage) {
    await writeSeasonWorksCache(season, result.works);
  }
  return result;
}

/**
 * 検索応答の 1 件（Annict の作品メタ + キャッシュ済み resolvedImageUrl ＋
 * R2 取り込み済みなら自前配信の hostedImageUrl）。
 */
type SearchWorkWithResolved = AnnictLibraryEntry & {
  resolvedImageUrl: string | null;
  hostedImageUrl: string | null;
};

/**
 * 検索結果の各作品に、キャッシュ済み resolvedImageUrl を「追加フィールド」として付与する。
 * imageUrl 自体は上書きしない — 表示ポリシーはクライアントの pickImageUrl に任せる。
 * 未解決 + Annict 画像が placeholder + malAnimeId 有 の作品は、まず AniList
 * バッチで同期解決を試みる（issue #108: 非同期解決だけだと初回表示に間に合わない）。
 * 取れなかった分は annict_works に upsert 済みの行として残り、cron が
 * pending 行を拾って Jikan を含めた解決を行う（issue #127: Queue 廃止）。
 */
async function attachResolvedImages(
  adb: ReturnType<typeof authorizedDb>,
  works: AnnictLibraryEntry[],
  requestUrl: string,
): Promise<SearchWorkWithResolved[]> {
  if (works.length === 0) return [];

  // getAnnictWorksByIds は inArray（= id 1 個につきバインド変数 1 個）なので、
  // シーズン全件（数百件）でも D1 の 100 変数上限を超えないようチャンクして引く。
  const ID_CHUNK = 90;
  const ids = works.map((w) => w.annictWorkId);
  const cached: Awaited<ReturnType<typeof adb.getAnnictWorksByIds>> = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    cached.push(...(await adb.getAnnictWorksByIds(ids.slice(i, i + ID_CHUNK))));
  }
  const cachedById = new Map(cached.map((w) => [w.annictWorkId, w]));

  const fallbackTargets: { annictWorkId: number; malAnimeId: number }[] = [];
  const enriched: SearchWorkWithResolved[] = works.map((w) => {
    const c0 = cachedById.get(w.annictWorkId);
    // 未解決 + Annict 画像が placeholder + malAnimeId 有 → 同期解決の対象にする。
    if (
      w.malAnimeId != null &&
      !c0?.imageSource &&
      isPlaceholderImageUrl(w.imageUrl)
    ) {
      fallbackTargets.push({
        annictWorkId: w.annictWorkId,
        malAnimeId: w.malAnimeId,
      });
    }
    return {
      ...w,
      resolvedImageUrl: c0?.resolvedImageUrl ?? null,
      // R2 取り込み済みの作品は自前 URL（GET /images/...）を最優先で
      // 表示させるため、配信 URL をここで組み立てて載せる（issue #174）。
      hostedImageUrl: hostedWorkImageUrl(requestUrl, c0?.imageR2Key),
    };
  });

  // 検索でユーザーに見せた作品はすべて annict_works にキャッシュする。
  // tier 表の保存（PUT /me/tier-lists）が items → annict_works の FK を要求する
  // ため、補完対象だけを upsert すると通常画像の作品で保存が 400 になる。
  // シーズン全件（数百件）は 1 往復ずつ書くと遅いので db.batch にまとめる
  // バルク upsert を使う。キャッシュ失敗は検索レスポンスを壊さないよう握りつぶす。
  const now = new Date();
  const upsertFailedIds = new Set<number>();
  const logUpsertFailed = (annictWorkId: number, err: unknown) =>
    console.error(
      JSON.stringify({
        level: "warn",
        event: "work_cache_upsert_failed",
        annictWorkId,
        error: err instanceof Error ? err.message : String(err),
      }),
    );

  // annict_works.title は NOT NULL。title 欠落の作品を batch に混ぜると
  // 正常な作品まで巻き込んで失敗するため事前に除外する。同一 annictWorkId の
  // 重複行も dedupe しておく（batch 内で行が競合しないように）。
  const rows = works.flatMap((w) => {
    if (!w.title?.trim()) {
      upsertFailedIds.add(w.annictWorkId);
      logUpsertFailed(w.annictWorkId, new Error("empty title"));
      return [];
    }
    return [
      {
        annictWorkId: w.annictWorkId,
        nodeId: w.nodeId,
        malAnimeId: w.malAnimeId,
        title: w.title,
        titleKana: w.titleKana,
        titleEn: w.titleEn,
        seasonName: w.seasonName,
        seasonYear: w.seasonYear,
        imageUrl: w.imageUrl,
        updatedAt: now,
      },
    ];
  });
  const dedupedRows = [
    ...new Map(rows.map((r) => [r.annictWorkId, r])).values(),
  ];
  try {
    await adb.upsertAnnictWorks(dedupedRows);
  } catch {
    // batch は原子的なので 1 件の不正行で全体が失敗する。正常な作品だけでも
    // キャッシュされるよう、行ごとの upsert にフォールバックする。
    for (const row of dedupedRows) {
      try {
        await adb.upsertAnnictWork(row);
      } catch (err) {
        upsertFailedIds.add(row.annictWorkId);
        logUpsertFailed(row.annictWorkId, err);
      }
    }
  }

  if (fallbackTargets.length > 0) {
    // 初回表示で大半の画像が出るよう、AniList バッチによる同期解決をここで行う。
    // 非同期解決に任せると初回表示までに全件解決が間に合わなかった（issue #108）。
    // AniList は 20 件/リクエストでまとめて取れるので応答経路に載せても軽い。
    // 同期解決そのものが失敗しても検索は壊さない — 残りは cron の解決に委ねる。
    try {
      const resolved = await resolveImagesViaAnilist(fallbackTargets);
      const resolvedById = new Map(resolved.map((r) => [r.annictWorkId, r]));
      const resolvedAt = new Date();
      // 作品行の upsert に失敗したものは update 先の行が無いので除外する。
      // update 対象が無い update は no-op だが、ここで書いたつもりになると
      // 永続化されないまま検知不能になってしまう。まとまった件数を行ごとに
      // 往復させないようバルク更新で書き込む。
      const persistable = resolved.filter(
        (r) => !upsertFailedIds.has(r.annictWorkId),
      );
      try {
        await adb.updateResolvedImages(
          persistable.map((r) => ({
            annictWorkId: r.annictWorkId,
            resolvedImageUrl: r.resolvedImageUrl,
            imageSource: r.imageSource,
            resolvedAt,
          })),
        );
      } catch (err) {
        console.error(
          JSON.stringify({
            level: "warn",
            event: "image_fallback_persist_failed",
            count: persistable.length,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
      // 解決した URL は永続化の成否に関わらず今回のレスポンスには載せる
      // （保存に失敗しても表示だけは改善する）。
      for (const w of enriched) {
        const r = resolvedById.get(w.annictWorkId);
        if (r?.resolvedImageUrl) w.resolvedImageUrl = r.resolvedImageUrl;
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          level: "warn",
          event: "image_fallback_inline_resolve_failed",
          count: fallbackTargets.length,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  return enriched;
}

export { works };
