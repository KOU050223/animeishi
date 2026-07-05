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
import { requireAnnictToken } from "@/lib/annict/middleware";
import { annictErrorResponse } from "@/lib/annict/errors";
import {
  isPlaceholderImageUrl,
  limitImageFallbackTargets,
  resolveImagesForWorks,
} from "@/lib/annict/imageFallback";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";

function getBindings(c: Context): AuthEnv["Bindings"] & { DB: D1Database } {
  return c.env as AuthEnv["Bindings"] & { DB: D1Database };
}

// Hono の c.executionCtx は本番 Workers では常に取れるが、テスト時の
// app.request では未提供で getter が throw する。安全に null を返す。
function safeExecutionCtx(c: Context): ExecutionContext | null {
  try {
    return c.executionCtx;
  } catch {
    return null;
  }
}

// 作品検索は Annict searchWorks をプロキシする。Animeishi は作品マスタを持たず、
// 検索のたびに Annict へ問い合わせる（docs/05 PR5）。視聴ステータスは含まない。
//
// title があればタイトル検索。無ければ season（明示 or 今期既定）でシーズン検索し、
// 検索画面の初期表示（今期アニメ）を返す。どちらも視聴者数の多い順ではないが、
// シーズン検索は WATCHERS_COUNT 降順で「人気の今期アニメ」を上位に出す。
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

      try {
        const result = trimmedTitle
          ? await searchAnnictWorksByTitle(
              c.var.annictToken,
              trimmedTitle,
              after ?? null,
            )
          : await searchAnnictWorksBySeason(
              c.var.annictToken,
              season ?? currentAnnictSeason(),
              after ?? null,
            );

        // 検索結果に resolvedImageUrl（キャッシュ済みの AniList / Jikan 由来 URL）を
        // 添えて返す。imageUrl 自体は上書きしない — 「Annict 画像を優先し、無ければ
        // resolved に落とす」の判定はクライアントの表示ポリシーであってサーバの
        // 責務ではない（クライアントの pickImageUrl で解決する。issue #86）。
        // 未解決 + Annict 画像が placeholder な作品は waitUntil で非同期解決する。
        const db = createDb(getBindings(c).DB);
        const adb = authorizedDb(db, c.var.clerkUserId);
        const executionCtx = safeExecutionCtx(c);
        const enriched = await attachResolvedImages(
          executionCtx,
          adb,
          result.works,
        );

        return c.json({ ...result, works: enriched }, 200);
      } catch (err) {
        const res = annictErrorResponse(c, err);
        if (res) return res;
        throw err;
      }
    },
  );

/** 検索応答の 1 件（Annict の作品メタ + キャッシュ済み resolvedImageUrl）。 */
type SearchWorkWithResolved = AnnictLibraryEntry & {
  resolvedImageUrl: string | null;
};

/**
 * 検索結果の各作品に、キャッシュ済み resolvedImageUrl を「追加フィールド」として付与する。
 * imageUrl 自体は上書きしない — 表示ポリシーはクライアントの pickImageUrl に任せる。
 * 未解決 + Annict 画像が placeholder + malAnimeId 有 の作品は waitUntil で
 * AniList / Jikan に非同期解決を依頼する。
 */
async function attachResolvedImages(
  // 本番の Hono は必ず ExecutionContext を持つが、テストの app.request では
  // 第 4 引数を省略するケースがあるため null 可能で受ける。
  executionCtx: ExecutionContext | null | undefined,
  adb: ReturnType<typeof authorizedDb>,
  works: AnnictLibraryEntry[],
): Promise<SearchWorkWithResolved[]> {
  if (works.length === 0) return [];

  const ids = works.map((w) => w.annictWorkId);
  const cached = await adb.getAnnictWorksByIds(ids);
  const cachedById = new Map(cached.map((w) => [w.annictWorkId, w]));

  const fallbackTargets: { annictWorkId: number; malAnimeId: number }[] = [];
  const enriched: SearchWorkWithResolved[] = works.map((w) => {
    const c0 = cachedById.get(w.annictWorkId);
    // 未解決 + Annict 画像が placeholder + malAnimeId 有 → 解決キューに積む
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

  if (fallbackTargets.length > 0 && executionCtx) {
    const limitedFallbackTargets = limitImageFallbackTargets(fallbackTargets);
    // 検索経路は annict_works にキャッシュ行が無い場合もあるため、
    // 先に作品メタを upsert してから resolved を書き込む必要がある。
    // ここでは waitUntil の裏で upsert → resolve → update の順に走らせる。
    const worksById = new Map(works.map((w) => [w.annictWorkId, w]));
    const now = new Date();
    executionCtx.waitUntil(
      (async () => {
        for (const t of limitedFallbackTargets) {
          const w = worksById.get(t.annictWorkId);
          if (!w) continue;
          await adb.upsertAnnictWork({
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
          });
        }
        const results = await resolveImagesForWorks(limitedFallbackTargets);
        const resolvedAt = new Date();
        for (const r of results) {
          await adb.updateResolvedImage(r.annictWorkId, {
            resolvedImageUrl: r.resolvedImageUrl,
            imageSource: r.imageSource,
            resolvedAt,
          });
        }
      })(),
    );
  }

  return enriched;
}

export { works };
