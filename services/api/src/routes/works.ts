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

        // 検索結果のうち、Annict の画像が空 or SNS placeholder な作品を
        // キャッシュから resolvedImageUrl で置き換え、未解決なら waitUntil に積む。
        // 検索は 50 件返るのでバッチ効果が最も大きい経路（issue #86）。
        const db = createDb(getBindings(c).DB);
        const adb = authorizedDb(db, c.var.clerkUserId);
        // c.executionCtx は本番 Workers 環境では常に取れるが、
        // Hono の型定義では getter が throw する実装で、テストの app.request
        // 経由では未提供のことがある。取れなければフォールバックは skip する。
        const executionCtx = safeExecutionCtx(c);
        const enriched = await enrichSearchResultWithFallback(
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

/**
 * 検索結果の works に対して、キャッシュ済み resolvedImageUrl を反映し、
 * 未解決の候補は waitUntil で AniList / Jikan に解決を依頼する。
 *
 * ここで返す works は AnnictLibraryEntry のシェイプを保つが、imageUrl フィールド
 * だけを「resolvedImageUrl ?? 元の imageUrl」に差し替える。クライアントが
 * imageSource を意識せずそのまま表示できるようにするためで、モバイル側の
 * 型変更を最小化する。
 */
async function enrichSearchResultWithFallback(
  // 本番の Hono は必ず ExecutionContext を持つが、テストの app.request では
  // 第 4 引数を省略するケースがあるため null 可能で受ける。
  executionCtx: ExecutionContext | null | undefined,
  adb: ReturnType<typeof authorizedDb>,
  works: AnnictLibraryEntry[],
): Promise<AnnictLibraryEntry[]> {
  if (works.length === 0) return works;

  const ids = works.map((w) => w.annictWorkId);
  const cached = await adb.getAnnictWorksByIds(ids);
  const cachedById = new Map(cached.map((w) => [w.annictWorkId, w]));

  const fallbackTargets: { annictWorkId: number; malAnimeId: number }[] = [];
  const enriched = works.map((w) => {
    const c0 = cachedById.get(w.annictWorkId);
    // 既にキャッシュに resolvedImageUrl があればそれを優先。imageSource='none'
    // なら「試したけど無かった」ネガキャッシュなので Annict 画像そのまま。
    if (c0?.resolvedImageUrl) {
      return { ...w, imageUrl: c0.resolvedImageUrl };
    }
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
    return w;
  });

  if (fallbackTargets.length > 0 && executionCtx) {
    // 検索経路は annict_works にキャッシュ行が無い場合もあるため、
    // 先に作品メタを upsert してから resolved を書き込む必要がある。
    // ここでは waitUntil の裏で upsert → resolve → update の順に走らせる。
    const worksById = new Map(works.map((w) => [w.annictWorkId, w]));
    const now = new Date();
    executionCtx.waitUntil(
      (async () => {
        for (const t of fallbackTargets) {
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
        const results = await resolveImagesForWorks(fallbackTargets);
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
