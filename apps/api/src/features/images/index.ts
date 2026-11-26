import { Hono } from "hono";
import { createDb } from "@/db/client";
import { serveWorkImage } from "@/lib/catalog/workImage";

/**
 * ?r= で受け付けるリトライ番号の上限。WorkImage（apps/mobile）の
 * RETRY_DELAYS_MS の要素数（r=1, 2）と揃える。範囲外の値はリトライとみなさず、
 * 通常の要求と同じくキャッシュを経由させる。
 */
const MAX_RETRY_ATTEMPT = 2;

/**
 * 作品画像の配信（公開・認証不要）。
 * GET /images/works/:annictWorkId は Kitsu / MAL 由来を R2 から配信し、
 * Annict 由来は元 URL へリダイレクトする
 * （詳細は lib/catalog/workImage.ts）。
 * アプリの <Image> と共有ページ HTML の <img> の両方から参照される。
 *
 * パスは数値 ID のみ受け付けるので、同じバケットの avatars/ 等には到達できない。
 *
 * 前段に Workers の Cache API を置く。作品一覧は 1 画面で数十枚の画像を
 * 要求するため、毎回 D1（作品行の参照）と R2 を読むと応答が遅く、D1 の
 * 読み取り行数も積み上がる。キャッシュ期間は serveWorkImage が付ける
 * Cache-Control（取り込み済み 1 日 / MAL 由来は 6 時間 / 画像なし 5 分）に従う。
 * MAL 由来を短くしているのは、削除依頼から 24 時間以内に消すため（issue #241）。
 */
export const images = new Hono<{
  Bindings: {
    AVATARS: R2Bucket;
    DB: D1Database;
    // MAL_CLIENT_ID は Workers Secret（画像補完の MAL API 用。issue #238）。
    MAL_CLIENT_ID?: string;
    IMAGE_RETRY_RATE_LIMITER?: RateLimit;
  };
}>().get("/works/:annictWorkId{[0-9]+}", async (c) => {
  const annictWorkId = Number(c.req.param("annictWorkId"));
  if (!Number.isSafeInteger(annictWorkId)) {
    return c.json({ error: "Not found", code: "not_found" }, 404);
  }

  // クエリ文字列でキャッシュを分けられないよう、パスだけでキーを作る。
  // 旧キーには Annict 画像の 200 が残り得るため、配信方式変更時に世代を切る。
  const cacheUrl = new URL(c.req.path, c.req.url);
  cacheUrl.searchParams.set("image-policy", "2");
  const cacheKey = new Request(cacheUrl.toString());
  const cache = defaultCache();
  // ?r=N はクライアント（WorkImage）のリトライ合図。取り込み完了直前の 404 が
  // edge に残っていると画像が用意できてもキャッシュが返り続けるため、この要求
  // だけは参照を飛ばしてオリジンで再評価する。取り込みが済んでいれば後段の
  // cache.put で正規キーのエントリも更新される。
  const rParam = c.req.query("r");
  const retry = isRetryAttempt(rParam);
  const gate: RetryGate = retry
    ? await retryGate(
        c.env.IMAGE_RETRY_RATE_LIMITER,
        c.req.header("CF-Connecting-IP"),
      )
    : "bypass";
  const cached =
    retry && gate === "bypass"
      ? undefined
      : await cache?.match(cacheKey).catch(() => undefined);
  // 制限を超えたリトライはキャッシュに無くてもオリジンへ通さない（issue #713）。
  // 429 がブラウザ / expo-image に残ると制限が解けても失敗が返り続けるので保存させない。
  if (!cached && gate === "deny") {
    c.header("Cache-Control", "no-store");
    c.header("Retry-After", "60");
    return c.json({ error: "Too many requests", code: "rate_limited" }, 429);
  }
  // キャッシュ由来の Response はヘッダが immutable なことがあり、後段の
  // CORS ミドルウェアがヘッダを足せなくなるので作り直して返す。
  if (cached) {
    const hit = new Response(cached.body, cached);
    // Cache-Tag は Purge 用に保存エントリへ付けたもので、クライアントには出さない。
    hit.headers.delete("cache-tag");
    // ?r= は再評価の合図なので、迂回を許さなかった応答（保存済みの 404 等）を
    // リトライ URL でクライアントに残すと、制限解除後も同じ再試行が API に届かない。
    // リトライとみなさない値（r=3 等）の URL も、将来有効になったとき残っていると
    // 同じ問題になるため、r パラメータ付きの応答は一律保存させない。
    if (rParam !== undefined) hit.headers.set("cache-control", "no-store");
    return hit;
  }

  const res = await serveWorkImage(
    createDb(c.env.DB),
    c.env.AVATARS,
    annictWorkId,
    { malClientId: c.env.MAL_CLIENT_ID },
  );
  if (
    cache &&
    (res.status === 200 || res.status === 302 || res.status === 404)
  ) {
    // ゾーンの Purge Cache（タグ指定）でこのエントリを消せるよう、保存する
    // エントリにだけ Cache-Tag を付ける（MISS 時の直接レスポンスには付けない）。
    // Cache API のエントリは caches.default.delete() だと実行した DC しか
    // 消えない。グローバルに消す手段として公式に挙げられているのは
    // Purge Everything とタグ指定で、削除スクリプトは work-image-<id> の
    // タグで消す（issue #244）。
    const stored = new Response(res.clone().body, res);
    stored.headers.set("cache-tag", `work-image-${annictWorkId}`);
    const put = cache.put(cacheKey, stored).catch(() => {});
    // テスト等で executionCtx が無い環境では投げるので、その場合は待つ。
    try {
      c.executionCtx.waitUntil(put);
    } catch {
      await put;
    }
  }
  // ?r= への応答はリトライ URL でクライアントに残さない（stored へは
  // 写らないよう cache.put の後で上書きする）。
  if (rParam !== undefined) res.headers.set("cache-control", "no-store");
  return res;
});

function isRetryAttempt(r: string | undefined): boolean {
  if (r === undefined || !/^[0-9]+$/.test(r)) return false;
  const attempt = Number(r);
  return attempt >= 1 && attempt <= MAX_RETRY_ATTEMPT;
}

/**
 * ?r= の要求の振り分け。
 * - "bypass": キャッシュを飛ばしてオリジン（D1・R2・外部 API）で再評価する。
 * - "deny": 制限超過。キャッシュ済みの応答を返し、無ければ 429。
 * - "degraded": 制限が掛けられないのでキャッシュを優先し、ミスだけオリジンへ通す。
 *
 * 画像は公開配信で、binding の設定漏れや limit() の失敗で全画像が 500 になるのを
 * 避けるため throw しない（demo-sign-in とは違う）。ただし binding が設定
 * されているのに limit() が失敗した状態で無制限にオリジンへ通すと制限の意味が
 * 無いため、その場合はキャッシュに倒す（binding 未設定は機能自体が無いので
 * 従来どおりオリジンへ通す）。
 */
type RetryGate = "bypass" | "deny" | "degraded";

async function retryGate(
  limiter: RateLimit | undefined,
  ip: string | undefined,
): Promise<RetryGate> {
  if (!limiter) return "bypass";
  const result = await limiter
    .limit({ key: `ip:${ip ?? "unknown"}` })
    .catch(() => null);
  if (result === null) return "degraded";
  return result.success ? "bypass" : "deny";
}

// Workers では caches.default が既定キャッシュ。ブラウザの DOM CacheStorage には
// default が無く、本ファイルは mobile 側の型検査（AppType 経由）でも検査対象に
// なるため、構造的に取り出す（seasonWorksCache.ts と同じ理由）。
function defaultCache(): Cache | null {
  try {
    const storage = caches as CacheStorage & { default?: Cache };
    return storage.default ?? null;
  } catch {
    return null;
  }
}
