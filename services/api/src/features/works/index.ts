import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { annictWorkIdParamSchema, worksSearchQuerySchema } from "./schema";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// features/watch-history/index.ts のコメント参照）。
import {
  currentAnnictSeason,
  fetchAnnictWorkCasts,
  searchAnnictWorksByTitle,
} from "@/lib/annict/client";
import { requireAnnictToken } from "@/lib/annict/middleware";
import {
  fetchAnilistCharacters,
  matchCharacterImages,
} from "@/lib/annict/characterImageFallback";
import { worksRepository } from "./repository";
import { attachResolvedImages, searchSeasonWorks } from "./service";
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
      const repo = worksRepository(db);
      const enriched = await attachResolvedImages(
        repo,
        result.works,
        c.req.url,
      );

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
      const repo = worksRepository(db);

      // キャラクター tier 表（character_tier_lists）の FK 先となる作品行と
      // キャラクター行をここでキャッシュする。作品自体は /works/search の
      // read-through でキャッシュ済みのことが多いが、キャラ一覧が保存の
      // 前提を満たすようこの経路でも upsert する。
      if (work.title?.trim()) {
        try {
          await repo.upsertAnnictWork({
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
      const cachedCharacters = await repo.getAnnictCharactersByIds(
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
        await repo.upsertAnnictCharacters(
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
        await repo.upsertAnnictWorkCasts(
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

export { works };
