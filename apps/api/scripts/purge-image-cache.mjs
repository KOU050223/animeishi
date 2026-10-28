#!/usr/bin/env node
// 画像プロキシ（GET /images/works/:id）前段の Workers Cache API
// （caches.default）エントリをゾーンの Purge Cache API で消す。
// takedown-work-images.sh から呼ぶ（issue #244）。
//
// Cache API のエントリは caches.default.delete() では実行したデータセンター
// しか消えない。グローバルに消す手段として Cloudflare のドキュメントが明記
// しているのは Purge Everything とタグ指定のみなので、タグ指定を使う
// （保存されるエントリには work-image-<id> の Cache-Tag を付けてある）。
// タグが付く前のデプロイで保存されたエントリはタグでは消せないため、
// Cache API のエントリにも効く可能性がある URL 指定も併せて送る
// （効かない環境では無害）。どうしても残るときは Purge Everything か
// 期限切れ（旧 TTL 最長 8 日）を待つ。
//
// 使い方:
//   node scripts/purge-image-cache.mjs <作品ID>...
//
// 環境変数:
//   CLOUDFLARE_ZONE_ID          uomi.dev ゾーンの ID（必須）
//   CLOUDFLARE_PURGE_API_TOKEN  Zone.Cache Purge 権限を持つ API トークン（必須）
//   IMAGE_PROXY_BASE_URL        Purge 対象の API オリジン
//                               （既定: https://animeishi-api.uomi.dev）
//
// 環境変数が足りないときは Purge せず、対象 URL 一覧と手動手順を表示して
// 終了コード 0 で終わる。API が失敗したときは失敗した分の URL を表示して 1。

import { pathToFileURL } from "node:url";

const CF_API_BASE = "https://api.cloudflare.com/client/v4";
const DEFAULT_API_BASE = "https://animeishi-api.uomi.dev";

// Purge by URL / Tag は 1 リクエストあたり非 Enterprise プランで
// 最大 100 件（https://developers.cloudflare.com/cache/how-to/purge-cache/）。
const PURGE_CHUNK_SIZE = 100;
const WORK_IMAGE_TAG_PREFIX = "work-image-";
const MAX_ATTEMPTS = 3;

/**
 * 作品 ID からプロキシの配信 URL を組み立てる。
 * @param {string} apiBase
 * @param {string} annictWorkId
 * @returns {string}
 */
export function workImageUrl(apiBase, annictWorkId) {
  return `${apiBase}/images/works/${annictWorkId}`;
}

/**
 * @param {string} annictWorkId
 * @returns {string}
 */
export function workImageTag(annictWorkId) {
  return `${WORK_IMAGE_TAG_PREFIX}${annictWorkId}`;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} size
 * @returns {T[][]}
 */
export function chunk(items, size) {
  const parts = [];
  for (let i = 0; i < items.length; i += size) {
    parts.push(items.slice(i, i + size));
  }
  return parts;
}

/**
 * Purge API に送るリクエストボディの一覧を組み立てる。
 * 件数が上限を超えるときは分割する（--all-mal で数百件になり得る）。
 * @param {string[]} ids
 * @param {string} apiBase
 * @returns {({ files: string[] } | { tags: string[] })[]}
 */
export function purgeBodies(ids, apiBase) {
  const bodies = [];
  for (const part of chunk(ids, PURGE_CHUNK_SIZE)) {
    bodies.push({ files: part.map((id) => workImageUrl(apiBase, id)) });
    bodies.push({ tags: part.map(workImageTag) });
  }
  return bodies;
}

/**
 * 1 件の Purge リクエストを送る。
 * @param {{ files?: string[]; tags?: string[] }} body
 * @param {{ zoneId: string; token: string; fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ ok: boolean; retryable: boolean; detail: string }>}
 */
async function postPurge(body, options) {
  const fetchImpl = options.fetchImpl ?? fetch;
  let res;
  try {
    res = await fetchImpl(
      `${CF_API_BASE}/zones/${options.zoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
    );
  } catch (error) {
    return { ok: false, retryable: true, detail: String(error) };
  }
  /** @type {{ success?: boolean; errors?: { message?: string }[] } | null} */
  const json = await res.json().catch(() => null);
  const detail =
    json?.errors
      ?.map((e) => e.message)
      .filter(Boolean)
      .join("; ") || `HTTP ${res.status}`;
  return {
    ok: res.ok && json?.success === true,
    // 4xx（認証・リクエスト不正）は再試行しても治らないので除外。429/5xx と
    // 通信エラーだけ再試行する。
    retryable: res.status === 429 || res.status >= 500,
    detail,
  };
}

/**
 * 作品 ID の一覧について Purge を実行し、失敗したリクエストを返す。
 * @param {string[]} ids
 * @param {{ zoneId: string; token: string; apiBase: string; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> }} options
 * @returns {Promise<{ body: { files?: string[]; tags?: string[] }; detail: string }[]>}
 */
export async function purgeImageCache(ids, options) {
  const sleep =
    options.sleep ??
    ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  /** @type {{ body: { files?: string[]; tags?: string[] }; detail: string }[]} */
  const failures = [];
  for (const body of purgeBodies(ids, options.apiBase)) {
    let result = { ok: false, retryable: false, detail: "" };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      result = await postPurge(body, options);
      if (result.ok || !result.retryable) break;
      if (attempt < MAX_ATTEMPTS) await sleep(2000 * attempt);
    }
    if (!result.ok) failures.push({ body, detail: result.detail });
  }
  return failures;
}

/**
 * Purge 用の環境変数を読む。不足している変数名を返す。
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true; zoneId: string; token: string; apiBase: string } | { ok: false; missing: string[] }}
 */
export function resolvePurgeEnv(env) {
  const missing = [
    ["CLOUDFLARE_ZONE_ID", env.CLOUDFLARE_ZONE_ID],
    ["CLOUDFLARE_PURGE_API_TOKEN", env.CLOUDFLARE_PURGE_API_TOKEN],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) return { ok: false, missing };
  return {
    ok: true,
    zoneId: /** @type {string} */ (env.CLOUDFLARE_ZONE_ID),
    token: /** @type {string} */ (env.CLOUDFLARE_PURGE_API_TOKEN),
    apiBase: (env.IMAGE_PROXY_BASE_URL ?? DEFAULT_API_BASE).replace(/\/+$/, ""),
  };
}

/**
 * 消せなかった URL の一覧と、ダッシュボードから手動で消す手順を出す。
 * @param {string[]} urls
 */
function printManualPurgeGuide(urls) {
  console.error("キャッシュに残っている可能性がある URL:");
  for (const url of urls) console.error(`  ${url}`);
  console.error(
    "手動で消すには Cloudflare ダッシュボード → uomi.dev → Caching → " +
      "Configuration → Purge Cache → Custom Purge で「Purge by: URL」を選び、" +
      "上記 URL を貼って Purge する。環境変数を設定してスクリプトを再実行してもよい" +
      "（手順: docs/runbook/production-tasks.md の「作品画像の削除」）。",
  );
}

async function main() {
  const args = process.argv.slice(2);
  const invalid = args.filter((arg) => !/^\d+$/.test(arg));
  if (invalid.length > 0) {
    console.error(`作品 ID は数値で指定してください: ${invalid.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  if (args.length === 0) {
    console.error("作品 ID を指定してください");
    process.exitCode = 1;
    return;
  }

  const apiBase = (
    process.env.IMAGE_PROXY_BASE_URL ?? DEFAULT_API_BASE
  ).replace(/\/+$/, "");
  const resolved = resolvePurgeEnv(process.env);
  if (!resolved.ok) {
    console.error(
      `${resolved.missing.join(" / ")} が未設定のためキャッシュ Purge をスキップします。`,
    );
    printManualPurgeGuide(args.map((id) => workImageUrl(apiBase, id)));
    return;
  }

  const failures = await purgeImageCache(args, {
    zoneId: resolved.zoneId,
    token: resolved.token,
    apiBase: resolved.apiBase,
  });
  if (failures.length > 0) {
    console.error("キャッシュ Purge に失敗したリクエストがあります:");
    const urls = [];
    for (const { body, detail } of failures) {
      console.error(`  ${JSON.stringify(body)} → ${detail}`);
      if (body.files) urls.push(...body.files);
      if (body.tags) {
        urls.push(
          ...body.tags.map((tag) =>
            workImageUrl(
              resolved.apiBase,
              tag.slice(WORK_IMAGE_TAG_PREFIX.length),
            ),
          ),
        );
      }
    }
    printManualPurgeGuide(urls);
    process.exitCode = 1;
    return;
  }
  console.error(
    `キャッシュ Purge を送信しました（${args.length} 作品・タグ + URL 指定）。`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
