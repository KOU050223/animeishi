import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { worksSearchQuerySchema } from "@/schema/validators";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// routes/watch-history.ts のコメント参照）。
import {
  currentAnnictSeason,
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
      const enriched = await attachResolvedImages(adb, result.works);

      return c.json({ ...result, works: enriched }, 200);
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

/** 検索応答の 1 件（Annict の作品メタ + キャッシュ済み resolvedImageUrl）。 */
type SearchWorkWithResolved = AnnictLibraryEntry & {
  resolvedImageUrl: string | null;
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
    return { ...w, resolvedImageUrl: c0?.resolvedImageUrl ?? null };
  });

  // 検索でユーザーに見せた作品はすべて annict_works にキャッシュする。
  // tier 表の保存（PUT /me/tier-lists）が items → annict_works の FK を要求する
  // ため、補完対象だけを upsert すると通常画像の作品で保存が 400 になる。
  // シーズン全件（数百件）は 1 往復ずつ書くと遅いので db.batch にまとめる
  // バルク upsert を使う。キャッシュ失敗は検索レスポンスを壊さないよう握りつぶす
  // （batch は原子的なので失敗時は全件を未永続化として扱う）。
  const now = new Date();
  const upsertFailedIds = new Set<number>();
  try {
    await adb.upsertAnnictWorks(
      works.map((w) => ({
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
      })),
    );
  } catch (err) {
    for (const w of works) upsertFailedIds.add(w.annictWorkId);
    console.error(
      JSON.stringify({
        level: "warn",
        event: "work_cache_upsert_failed",
        count: works.length,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
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
