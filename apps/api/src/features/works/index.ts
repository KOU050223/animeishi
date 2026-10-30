import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  annictWorkIdParamSchema,
  worksLookupQuerySchema,
  worksSearchQuerySchema,
} from "./schema";
// 注: barrel（@/lib/annict）ではなくサブモジュールを直接 import する（理由は
// features/watch-history/index.ts のコメント参照）。
import {
  currentAnnictSeason,
  fetchAnnictWorkCasts,
  fetchAnnictWorkDetail,
  searchAnnictWorksByIds,
  searchAnnictWorksByTitle,
} from "@/lib/annict/client";
import { requireAnnictToken } from "@/lib/annict/middleware";
import { workImageUrl } from "@/lib/annict/workImage";
import {
  fetchKitsuCharacters,
  isAnilistImageUrl,
  matchCharacterImages,
} from "@/lib/annict/characterImageFallback";
import { worksRepository } from "./repository";
import {
  attachResolvedImages,
  searchSeasonWorks,
  type SearchWorkWithResolved,
} from "./service";
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

      // 検索結果に resolvedImageUrl（キャッシュ済みの Kitsu / MAL 由来 URL）を
      // 添えて返す。imageUrl 自体は上書きしない。クライアントは画像プロキシの
      // hostedImageUrl だけを表示に使い、候補の選択はプロキシが行う（issue #224）。
      // 未解決 + Annict 画像が placeholder な作品は、まとめて取れる Kitsu
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
  // 作品 ID のまとめ解決（issue #348）。自由作成 tier 表の作成画面が
  // #349（作品リスト）からルートパラメータで引き継いだ初期作品 ID の
  // メタを解決するためのもの。検索（/works/search）では ID では引けない
  // ため別エンドポイントにしてある。キャッシュ（annict_works）を優先し、
  // 無い作品だけ Annict に問い合わせる。
  .get(
    "/lookup",
    requireAnnictToken,
    zValidator("query", worksLookupQuerySchema),
    async (c) => {
      const { ids } = c.req.valid("query");
      const db = createDb(getBindings(c).DB);
      const repo = worksRepository(db);

      const cached = await repo.getAnnictWorksByIds(ids);
      const cachedById = new Map(cached.map((w) => [w.annictWorkId, w]));
      const missingIds = ids.filter((id) => !cachedById.has(id));

      // キャッシュに無いものだけ Annict へ。attachResolvedImages が
      // annict_works に upsert するので、tier 表保存の FK 前提も満たされる。
      const fetched = missingIds.length
        ? await attachResolvedImages(
            repo,
            await searchAnnictWorksByIds(c.var.annictToken, missingIds),
            c.req.url,
          )
        : [];
      const fetchedById = new Map(fetched.map((w) => [w.annictWorkId, w]));

      // 引き継ぎ元リストの並びを保つため、リクエストの ID 順で返す。
      // Annict にも存在しない ID は落とす（参照不能な作品で一覧を壊さない）。
      // キャッシュ由来の行は Annict 検索応答と違い nodeId/state が無い・
      // nullable なので、広い方の要素型を明示して両分岐を統一する。
      type LookupWork = Omit<SearchWorkWithResolved, "nodeId" | "state"> & {
        nodeId: string | null;
        state: string | null;
      };
      const result = ids.flatMap((id): LookupWork[] => {
        const fetchedWork = fetchedById.get(id);
        if (fetchedWork) return [fetchedWork];
        const cachedWork = cachedById.get(id);
        if (!cachedWork) return [];
        return [
          {
            annictWorkId: cachedWork.annictWorkId,
            nodeId: cachedWork.nodeId,
            state: null,
            title: cachedWork.title,
            titleKana: cachedWork.titleKana,
            titleEn: cachedWork.titleEn,
            seasonName: cachedWork.seasonName,
            seasonYear: cachedWork.seasonYear,
            imageUrl: cachedWork.imageUrl,
            malAnimeId: cachedWork.malAnimeId,
            watchersCount: cachedWork.watchersCount,
            resolvedImageUrl: cachedWork.resolvedImageUrl,
            hostedImageUrl: workImageUrl(c.req.url, id),
            genres: cachedWork.genres,
          },
        ];
      });
      return c.json({ works: result }, 200);
    },
  )
  // 作品詳細シートに出す単一作品のメタ（issue #347）。search で返さない
  // 詳細フィールド（話数・メディア種別・公式サイト等）と、viewerStatusState
  // 由来の視聴ステータス（state）を返す。画像は検索と同じく
  // attachResolvedImages で hostedImageUrl に載せる（annict_works の
  // キャッシュ upsert もこの経路で行う）。
  // /lookup より後に登録する（先に置くと "lookup" が :annictWorkId に
  // マッチして 400 になる）。
  .get(
    "/:annictWorkId",
    requireAnnictToken,
    zValidator("param", annictWorkIdParamSchema),
    async (c) => {
      const { annictWorkId } = c.req.valid("param");
      const detail = await fetchAnnictWorkDetail(
        c.var.annictToken,
        annictWorkId,
      );
      if (!detail) return c.json({ error: "Work not found" }, 404);

      const db = createDb(getBindings(c).DB);
      const repo = worksRepository(db);
      const [enriched] = await attachResolvedImages(repo, [detail], c.req.url);
      return c.json({ work: enriched }, 200);
    },
  )
  // 作品に紐づくキャラクター一覧（キャラクター tier 表の対象名簿。issue #169）。
  // Annict GraphQL の Character 型は画像を持たないため、キャラクター画像は
  // work.malAnimeId 経由で Kitsu のキャラクター一覧を取り、正規化名の
  // 名寄せで補完する（characterImageFallback.ts。AniList は Workers から
  // 403 になるため #227 で Kitsu に切り替え）。取れないキャラは
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

      // 既存キャッシュの imageUrl を拾い、未取得分だけ Kitsu 名寄せで補完する。
      const cachedCharacters = await repo.getAnnictCharactersByIds(
        characters.map((ch) => ch.annictCharacterId),
      );
      const cachedImageById = new Map(
        cachedCharacters
          .filter((ch) => ch.imageUrl)
          .map((ch) => [ch.annictCharacterId, ch.imageUrl as string]),
      );

      // 全キャラクターの画像がキャッシュ済みなら Kitsu を呼ばない
      // （キャッシュ済みでも毎回直列で往復すると応答が遅延する）。
      // ただし旧 AniList 名寄せ時代の URL（s4.anilist.co 等）が残っている
      // キャラは未解決扱いにして Kitsu で取り直す。取れなかった場合は
      // 従来どおり既存値をフォールバックとして返す（下の ?? 連鎖と
      // upsert の coalesce で温存される）。
      const resolvedImages = new Map<number, string>();
      const hasUnresolved = characters.some((ch) => {
        const cached = cachedImageById.get(ch.annictCharacterId);
        return cached == null || isAnilistImageUrl(cached);
      });
      if (work.malAnimeId != null && hasUnresolved) {
        try {
          const kitsuCharacters = await fetchKitsuCharacters(work.malAnimeId);
          for (const [id, url] of matchCharacterImages(
            characters,
            kitsuCharacters,
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
