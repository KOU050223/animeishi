import type { Context } from "hono";
import type { DrizzleDb } from "@/db/client";
import { escapeHtml } from "@/lib/html";
import {
  fetchFollowingRedirects,
  isPublicImageUrl,
  readBodyWithLimit,
} from "@/lib/http";
import { hostedWorkImageUrl } from "@/lib/annict/imagePrefetch";
import { isKnownImageUrl } from "./repository";
import type { SharedCharacterTierList, SharedTierList } from "./repository";

export type TierRow = { key: string; label: string; color: string };

/**
 * tiers_json（ユーザー定義の行）の防御的パース。
 * 壊れていても共有ページ自体は開けるよう、不正なら空配列に落とす。
 */
export function parseTiersJson(json: string): TierRow[] {
  const isTierRow = (r: unknown): r is TierRow =>
    typeof r === "object" &&
    r !== null &&
    typeof (r as TierRow).key === "string" &&
    typeof (r as TierRow).label === "string" &&
    typeof (r as TierRow).color === "string";
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed) || !parsed.every(isTierRow)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * 共有リンクの公開エンドポイント。
 * トークンを知っていれば誰でも読める仕様なので requireAuth は掛けない。
 * ブラウザ（Accept: text/html）には OGP 付きの静的ページを、
 * アプリ等の JSON クライアントには構造化データを返す。
 */
// 画像プロキシの制限値。外部 CDN の作品ポスター（数 KB〜数百 KB）を
// 想定し、5 MB を上限とする。
const IMAGE_PROXY_TIMEOUT_MS = 8000;
const IMAGE_PROXY_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_PROXY_MAX_REDIRECTS = 3;
const IMAGE_CONTENT_TYPE_PATTERN = /^image\//i;

/**
 * Web 版の画像エクスポート用プロキシ。Annict / AniList / MAL 等の外部 CDN は
 * CORS ヘッダを返さないため、html-to-image による DOM の画像インライン化が
 * 失敗する。同一 API 経由で取得し直すことで CORS 付きの画像として配信する。
 *
 * 公開エンドポイント（認証不要）だがオープンプロキシにはしない:
 * - url は DB 保存済みの画像（annict_works の作品画像 / annict_characters の
 *   キャラクター画像）に実在するものだけ許可（無ければ 403）
 * - https スキームかつ公開ホストのみ許可（http は Mixed Content、
 *   内部宛先は SSRF になりうるため拒否）
 * - リダイレクトは manual で扱い、遷移先も同じ検証（公開ホスト + DB 実在）を通す
 * - 応答 Content-Type が image/* であること（SVG はスクリプトを含み得るため除外）
 * - サイズ上限・nosniff を必須条件にする
 */
export async function proxyImage(c: Context, db: DrizzleDb, url: string) {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return c.json({ error: "Invalid url" }, 400);
  }
  if (target.protocol !== "https:") {
    return c.json({ error: "Only https URLs are allowed" }, 400);
  }
  // 画像 CDN は https の公開ホストのみ。内部宛先（IP リテラル・
  // localhost 系・標準外ポート）を指す既知 URL が紛れていても fetch しない
  // （SSRF 対策、Devin Review 指摘）。
  if (!isPublicImageUrl(target.toString())) {
    return c.json({ error: "Only public https URLs are allowed" }, 400);
  }
  if (!(await isKnownImageUrl(db, target.toString()))) {
    return c.json({ error: "Image URL is not a known image" }, 403);
  }

  // リダイレクトは自動追従しない。遷移先が公開ホスト検証・DB 照合の
  // 両方を通らない限り追わず、最大ホップ数を超えた場合も拒否する。
  const followed = await fetchFollowingRedirects(target.toString(), {
    timeoutMs: IMAGE_PROXY_TIMEOUT_MS,
    maxRedirects: IMAGE_PROXY_MAX_REDIRECTS,
    isAllowed: async (url) =>
      isPublicImageUrl(url) && (await isKnownImageUrl(db, url)),
  });
  if (followed.kind === "failed") {
    const message = {
      fetch_error: "Failed to fetch image",
      missing_location: "Upstream image not available",
      blocked: "Redirect target is not allowed",
      too_many_redirects: "Too many redirects",
    }[followed.reason];
    return c.json({ error: message }, 502);
  }
  const upstream = followed.response;
  if (!upstream.ok) {
    return c.json({ error: "Upstream image not available" }, 502);
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  // SVG はスクリプトを含み得るため配信しない。それ以外も Content-Type が
  // image/* でない応答は拒否し、HTML/JS 等がこのドメインから出ないようにする。
  if (
    !IMAGE_CONTENT_TYPE_PATTERN.test(contentType) ||
    /svg/i.test(contentType)
  ) {
    return c.json({ error: "Upstream response is not an image" }, 502);
  }

  const declaredLength = Number(upstream.headers.get("content-length") ?? 0);
  if (declaredLength > IMAGE_PROXY_MAX_BYTES) {
    return c.json({ error: "Image too large" }, 502);
  }
  // content-length が無い応答を arrayBuffer() で読むと全量メモリに乗るため、
  // ストリームで上限まで読み、超過した時点で中断する。読み取り中の切断・
  // タイムアウトも上流の取得失敗として 502 にする。
  const read = await readBodyWithLimit(upstream.body, IMAGE_PROXY_MAX_BYTES);
  if (!read.ok) {
    return c.json(
      { error: read.tooLarge ? "Image too large" : "Failed to fetch image" },
      502,
    );
  }

  return new Response(read.data, {
    headers: {
      "content-type": contentType,
      // 作品画像は URL 単位でほぼ不変なので CDN/ブラウザにキャッシュさせる。
      "cache-control": "public, max-age=86400",
      "x-content-type-options": "nosniff",
    },
  });
}

/**
 * 公開 HTML の <img src> に入れてよい URL か。
 * 作品メタは外部データ由来なので、http(s) 以外のスキーム（data: 等）は
 * 属性エスケープだけでは表示先を制限できない。ここで絞る。
 */
export function isSafeImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

export function workImageHtml(
  item: SharedTierList["items"][number],
  requestUrl: string,
): string {
  // R2 取り込み済みなら自前配信 URL を最優先（issue #174）。
  // resolvedImageUrl が真値でも不安全なら imageUrl 側を使う
  // （resolved が "javascript:" 等のとき imageUrl が有効でも画像欠落するため）
  const src = [
    hostedWorkImageUrl(requestUrl, item.imageR2Key),
    item.resolvedImageUrl,
    item.imageUrl,
  ].find((u): u is string => !!u && isSafeImageUrl(u));
  if (!src) return "";
  return `<img class="work-image" src="${escapeHtml(src)}" alt="" loading="lazy" />`;
}

export function buildSharedTierListHtml(
  list: SharedTierList,
  requestUrl: string,
): string {
  const tiers = parseTiersJson(list.tiersJson);
  const itemsByTier = new Map<string, SharedTierList["items"]>();
  for (const item of list.items) {
    const arr = itemsByTier.get(item.tierKey) ?? [];
    arr.push(item);
    itemsByTier.set(item.tierKey, arr);
  }

  const title = `${escapeHtml(list.title)} - Animeishi`;
  const description = `${escapeHtml(list.ownerUsername)} のアニメ Tier 表`;

  // og:image には先頭の作品画像を使う。クローラは直接取得できるため
  // プロキシ経由は不要。https を優先し、無ければ最初の安全な URL。
  // resolvedImageUrl が不安全なら imageUrl 側も候補にする
  // （ページ上のポスター表示 workImageHtml と同じ選び方）。
  const ogImageCandidates = list.items
    .flatMap((item) => [
      hostedWorkImageUrl(requestUrl, item.imageR2Key),
      item.resolvedImageUrl,
      item.imageUrl,
    ])
    .filter((u): u is string => !!u && isSafeImageUrl(u));
  const ogImage =
    ogImageCandidates.find((u) => /^https:/i.test(u.trim())) ??
    ogImageCandidates[0];

  const rowsHtml = tiers
    .map((tier) => {
      const works = itemsByTier.get(tier.key) ?? [];
      const worksHtml = works
        .map(
          (item) => `<div class="work">
      ${workImageHtml(item, requestUrl)}
      <span class="work-title">${escapeHtml(item.title)}</span>
    </div>`,
        )
        .join("");
      return `<div class="tier-row">
    <div class="tier-label" style="background-color: ${escapeHtml(tier.color)}">${escapeHtml(tier.label)}</div>
    <div class="tier-works">${worksHtml}</div>
  </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="website" />
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}" />` : ""}
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <style>
    body { font-family: sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
    .owner { color: #555; margin: 4px 0 24px; }
    .tier-row { display: flex; align-items: stretch; margin-bottom: 8px; border-radius: 8px; overflow: hidden; background: #f5f5f5; }
    .tier-label { display: flex; align-items: center; justify-content: center; min-width: 64px; max-width: 40%; padding: 8px; font-weight: bold; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.4); overflow-wrap: anywhere; }
    .tier-works { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; flex: 1; }
    .work { width: 80px; text-align: center; }
    .work-image { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; background: #ddd; }
    .work-title { display: block; font-size: 0.75rem; color: #333; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  </style>
</head>
<body>
  <h1>${escapeHtml(list.title)}</h1>
  <p class="owner">${escapeHtml(list.ownerUsername)} の Tier 表（${escapeHtml(list.season)}）</p>
  ${rowsHtml}
</body>
</html>`;
}

export function characterImageHtml(
  item: SharedCharacterTierList["items"][number],
): string {
  const src = item.imageUrl;
  if (!src || !isSafeImageUrl(src)) return "";
  return `<img class="character-image" src="${escapeHtml(src)}" alt="" loading="lazy" />`;
}

export function buildSharedCharacterTierListHtml(
  list: SharedCharacterTierList,
): string {
  const tiers = parseTiersJson(list.tiersJson);
  const itemsByTier = new Map<string, SharedCharacterTierList["items"]>();
  for (const item of list.items) {
    const arr = itemsByTier.get(item.tierKey) ?? [];
    arr.push(item);
    itemsByTier.set(item.tierKey, arr);
  }

  const title = `${escapeHtml(list.title)} - Animeishi`;
  const description = `${escapeHtml(list.ownerUsername)} の${escapeHtml(list.workTitle)} キャラクター Tier 表`;

  // og:image には先頭のキャラクター画像を使う。
  const ogImage = list.items
    .map((item) => item.imageUrl)
    .find((u): u is string => !!u && isSafeImageUrl(u) && /^https:/i.test(u));

  const rowsHtml = tiers
    .map((tier) => {
      const characters = itemsByTier.get(tier.key) ?? [];
      const charactersHtml = characters
        .map(
          (item) => `<div class="character">
      ${characterImageHtml(item)}
      <span class="character-name">${escapeHtml(item.name)}</span>
    </div>`,
        )
        .join("");
      return `<div class="tier-row">
    <div class="tier-label" style="background-color: ${escapeHtml(tier.color)}">${escapeHtml(tier.label)}</div>
    <div class="tier-characters">${charactersHtml}</div>
  </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="website" />
  ${ogImage ? `<meta property="og:image" content="${escapeHtml(ogImage)}" />` : ""}
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <style>
    body { font-family: sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
    .owner { color: #555; margin: 4px 0 24px; }
    .tier-row { display: flex; align-items: stretch; margin-bottom: 8px; border-radius: 8px; overflow: hidden; background: #f5f5f5; }
    .tier-label { display: flex; align-items: center; justify-content: center; min-width: 64px; max-width: 40%; padding: 8px; font-weight: bold; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.4); overflow-wrap: anywhere; }
    .tier-characters { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; flex: 1; }
    .character { width: 80px; text-align: center; }
    .character-image { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; background: #ddd; }
    .character-name { display: block; font-size: 0.75rem; color: #333; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  </style>
</head>
<body>
  <h1>${escapeHtml(list.title)}</h1>
  <p class="owner">${escapeHtml(list.ownerUsername)} の${escapeHtml(list.workTitle)} キャラクター Tier 表</p>
  ${rowsHtml}
</body>
</html>`;
}

export function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>Tier 表が見つかりません - Animeishi</title>
</head>
<body>
  <h1>Tier 表が見つかりません</h1>
  <p>この共有リンクは無効になったか、存在しません。</p>
</body>
</html>`;
}
