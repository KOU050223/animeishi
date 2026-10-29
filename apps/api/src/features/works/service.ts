import type { AnnictLibraryEntry } from "@/lib/annict/client";
import { searchAnnictWorksBySeason } from "@/lib/annict/client";
import {
  readSeasonWorksCache,
  writeSeasonWorksCache,
} from "@/lib/annict/seasonWorksCache";
import {
  isPlaceholderImageUrl,
  resolveImagesViaKitsu,
} from "@/lib/annict/imageFallback";
import { workImageUrl } from "@/lib/annict/workImage";
import { isUnchangedCachedWork, type WorksRepository } from "./repository";

/**
 * シーズン検索の入口。1 ページ目（after 無し）はシーズン単位の Cache API
 * キャッシュを参照し、ミス時のみ Annict へ全ページ取得しにいく。
 * after 指定はクライアントの追い読み（上限到達時の継続取得）なので
 * キャッシュを介さず Annict を叩く。取得が打ち切られた（hasNextPage=true の）
 * 部分結果は「全件」として共有できないためキャッシュしない。
 */
export async function searchSeasonWorks(
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
 * 自前の画像プロキシ URL hostedImageUrl）。
 */
export type SearchWorkWithResolved = AnnictLibraryEntry & {
  resolvedImageUrl: string | null;
  hostedImageUrl: string | null;
};

/**
 * 作品メタに画像プロキシ用フィールドを付与した型。
 * 詳細エンドポイント（AnnictWorkDetail 等、entry を拡張した型）でも
 * 追加フィールドを失わないようジェネリックにする（issue #347）。
 */
export type WithResolvedImages<T extends AnnictLibraryEntry> = T & {
  resolvedImageUrl: string | null;
  hostedImageUrl: string | null;
};

/**
 * 検索結果の各作品に、キャッシュ済み resolvedImageUrl を「追加フィールド」として付与する。
 * imageUrl 自体は上書きしない。表示に使う候補の選択は画像プロキシが行う
 * （クライアントは hostedImageUrl だけを表示する。issue #224）。
 * 未解決 + Annict 画像が placeholder + malAnimeId か Kitsu 作品 ID 有
 * の作品は、まず Kitsu バッチで同期解決を試みる
 * （issue #108: 非同期解決だけだと初回表示に間に合わない）。
 * 取れなかった分は annict_works に upsert 済みの行として残り、cron が
 * pending 行を拾って解決する（issue #127: Queue 廃止）。
 */
export async function attachResolvedImages<T extends AnnictLibraryEntry>(
  repo: WorksRepository,
  works: T[],
  requestUrl: string,
): Promise<WithResolvedImages<T>[]> {
  if (works.length === 0) return [];

  // getAnnictWorksByIds は inArray（= id 1 個につきバインド変数 1 個）なので、
  // シーズン全件（数百件）でも D1 の 100 変数上限を超えないようチャンクして引く。
  const ID_CHUNK = 90;
  const ids = works.map((w) => w.annictWorkId);
  const cached: Awaited<ReturnType<WorksRepository["getAnnictWorksByIds"]>> =
    [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    cached.push(
      ...(await repo.getAnnictWorksByIds(ids.slice(i, i + ID_CHUNK))),
    );
  }
  const cachedById = new Map(cached.map((w) => [w.annictWorkId, w]));

  const fallbackTargets: {
    annictWorkId: number;
    malAnimeId: number | null;
    kitsuAnimeId: number | null;
  }[] = [];
  const enriched: WithResolvedImages<T>[] = works.map((w) => {
    const c0 = cachedById.get(w.annictWorkId);
    // 未解決 + Annict 画像が placeholder + malAnimeId か Kitsu ID 有
    // → 同期解決の対象にする（kitsuAnimeId はタイトル検索で採った行。
    // issue #227）。'blocked'（削除依頼で画像を消した作品。issue #241）も
    // imageSource が立っているので対象にならない。
    if (
      (w.malAnimeId != null || c0?.kitsuAnimeId != null) &&
      !c0?.imageSource &&
      isPlaceholderImageUrl(w.imageUrl)
    ) {
      fallbackTargets.push({
        annictWorkId: w.annictWorkId,
        malAnimeId: w.malAnimeId,
        kitsuAnimeId: c0?.kitsuAnimeId ?? null,
      });
    }
    return {
      ...w,
      resolvedImageUrl: c0?.resolvedImageUrl ?? null,
      // 自前の画像プロキシ（GET /images/works/:id）。クライアントはこれだけを
      // 表示する。annict_works への upsert に失敗した作品は
      // プロキシが行を引けず必ず 404 になるため、upsert 後に外す（下記）。
      hostedImageUrl: workImageUrl(requestUrl, w.annictWorkId),
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
  // 既にキャッシュ済みで内容が変わっていない作品は書かない。シーズン一覧の
  // 検索は数百件を返すため、毎回全件 upsert すると D1 の書き込み行数
  // （Free プラン 100k 行/日）の過半をこの経路だけで消費していた。
  // 比較に使う cachedById は補完対象の判定用に読んだものを流用する。
  const dedupedRows = [
    ...new Map(rows.map((r) => [r.annictWorkId, r])).values(),
  ].filter((r) => !isUnchangedCachedWork(r, cachedById.get(r.annictWorkId)));
  try {
    await repo.upsertAnnictWorks(dedupedRows);
  } catch {
    // batch は原子的なので 1 件の不正行で全体が失敗する。正常な作品だけでも
    // キャッシュされるよう、行ごとの upsert にフォールバックする。
    for (const row of dedupedRows) {
      try {
        await repo.upsertAnnictWork(row);
      } catch (err) {
        upsertFailedIds.add(row.annictWorkId);
        logUpsertFailed(row.annictWorkId, err);
      }
    }
  }

  for (const w of enriched) {
    if (upsertFailedIds.has(w.annictWorkId)) w.hostedImageUrl = null;
  }

  if (fallbackTargets.length > 0) {
    // 初回表示で大半の画像が出るよう、Kitsu バッチによる同期解決をここで行う。
    // 非同期解決に任せると初回表示までに全件解決が間に合わなかった（issue #108）。
    // Kitsu は 20 件/リクエストでまとめて取れるので応答経路に載せても軽い。
    // 同期解決そのものが失敗しても検索は壊さない — 残りは cron の解決に委ねる。
    try {
      const resolved = await resolveImagesViaKitsu(fallbackTargets);
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
        await repo.updateResolvedImages(
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
