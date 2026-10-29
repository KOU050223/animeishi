import type { Context } from "hono";
import type { DrizzleDb } from "@/db/client";
import { escapeHtml } from "@/lib/html";
import {
  fetchFollowingRedirects,
  isPublicImageUrl,
  readBodyWithLimit,
} from "@/lib/http";
import { workImageUrl } from "@/lib/annict/workImage";
import { isKnownImageUrl } from "./repository";
import type {
  SharedCharacterTierList,
  SharedTierList,
  SharedWatchHistory,
} from "./repository";

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

/** ラベル文字色の候補。アプリ側 lib/tierList/label.ts と同じ値。 */
const TIER_LABEL_TEXT_DARK = "#1f2937";
const TIER_LABEL_TEXT_LIGHT = "#ffffff";

// WCAG 2.x の相対輝度（#RRGGBB 以外はパース不能として null）。
// https://www.w3.org/TR/WCAG/#dfn-relative-luminance
function relativeLuminance(color: string): number | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(color.trim());
  if (!match || !match[1]) return null;
  const n = parseInt(match[1], 16);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return (
    0.2126 * channel((n >> 16) & 0xff) +
    0.7152 * channel((n >> 8) & 0xff) +
    0.0722 * channel(n & 0xff)
  );
}

function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * tier ラベルセルの文字色。tier.color はユーザーが自由に変えられるため、
 * 背景とのコントラストが高い側を濃色/白から選ぶ（アプリ側
 * lib/tierList/label.ts の tierLabelTextColor と同じ判定）。
 * パース不能な色はアプリ側と同じく濃色に倒す。
 */
function tierLabelTextColor(backgroundColor: string): string {
  const bg = relativeLuminance(backgroundColor);
  if (bg === null) return TIER_LABEL_TEXT_DARK;
  const dark = relativeLuminance(TIER_LABEL_TEXT_DARK) ?? 0;
  return contrastRatio(bg, dark) >= contrastRatio(bg, 1)
    ? TIER_LABEL_TEXT_DARK
    : TIER_LABEL_TEXT_LIGHT;
}

// 共有ページの <img> が読み込みに失敗したときのハンドラ。data-fallback に
// JSON 配列で載せた残りの候補を先頭から順に試し、尽きたら要素ごと消す
// （壊れた画像アイコンを出さない）。URL は属性値として escape 済みのものを
// dataset から読むだけで、スクリプト本体にユーザー由来の値は埋め込まない。
const WORK_IMAGE_ONERROR =
  "var a=[];try{a=JSON.parse(this.dataset.fallback||'[]')}catch(e){}var u=a.shift();if(u){this.dataset.fallback=JSON.stringify(a);this.src=u}else{this.remove()}";

export function workImageHtml(
  item: SharedTierList["items"][number],
  requestUrl: string,
): string {
  // 自前の画像プロキシ URL を最優先（外部候補の取得・R2 保存はプロキシが担う）。
  // プロキシが 404 を返す作品（サーバからは取れないがブラウザなら表示できる
  // 外部画像など）に備えて、残りの候補を onerror の切り替え先に載せる。
  // resolvedImageUrl が真値でも不安全なら imageUrl 側を使う
  // （resolved が "javascript:" 等のとき imageUrl が有効でも画像欠落するため）
  const candidates = [
    ...new Set(
      [
        workImageUrl(requestUrl, item.annictWorkId),
        item.resolvedImageUrl,
        item.imageUrl,
      ].filter((u): u is string => !!u && isSafeImageUrl(u)),
    ),
  ];
  const [src, ...fallbacks] = candidates;
  if (!src) return "";
  const fallbackAttr =
    fallbacks.length > 0
      ? ` data-fallback="${escapeHtml(JSON.stringify(fallbacks))}" onerror="${WORK_IMAGE_ONERROR}"`
      : ` onerror="this.remove()"`;
  return `<img class="work-image" src="${escapeHtml(src)}"${fallbackAttr} alt="" loading="lazy" />`;
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
      workImageUrl(requestUrl, item.annictWorkId),
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
    <div class="tier-label" style="background-color: ${escapeHtml(tier.color)}; color: ${tierLabelTextColor(tier.color)}">${escapeHtml(tier.label)}</div>
    <div class="tier-works">${worksHtml}</div>
  </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- ダーク閲覧時にスクロールバー等の UI クロームも追従させる -->
  <meta name="color-scheme" content="light dark" />
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
    .tier-label { display: flex; align-items: center; justify-content: center; min-width: 64px; max-width: 40%; padding: 8px; font-weight: bold; overflow-wrap: anywhere; }
    .tier-works { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; flex: 1; }
    .work { width: 80px; text-align: center; }
    .work-image { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; background: #ddd; }
    .work-title { display: block; font-size: 0.75rem; color: #333; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    /* アプリの盤面と同じく、閲覧者のシステムスキームに追従して
       ダーク配色へ切り替える（アプリの dark トークンと同じ slate 系）。 */
    @media (prefers-color-scheme: dark) {
      body { background: #0f172a; color: #f1f5f9; }
      .owner { color: #94a3b8; }
      .tier-row { background: #1e293b; }
      .work-image { background: #334155; }
      .work-title { color: #cbd5e1; }
    }
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
    <div class="tier-label" style="background-color: ${escapeHtml(tier.color)}; color: ${tierLabelTextColor(tier.color)}">${escapeHtml(tier.label)}</div>
    <div class="tier-characters">${charactersHtml}</div>
  </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- ダーク閲覧時にスクロールバー等の UI クロームも追従させる -->
  <meta name="color-scheme" content="light dark" />
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
    .tier-label { display: flex; align-items: center; justify-content: center; min-width: 64px; max-width: 40%; padding: 8px; font-weight: bold; overflow-wrap: anywhere; }
    .tier-characters { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; flex: 1; }
    .character { width: 80px; text-align: center; }
    .character-image { width: 80px; height: 80px; object-fit: cover; border-radius: 6px; background: #ddd; }
    .character-name { display: block; font-size: 0.75rem; color: #333; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
    /* アプリの盤面と同じく、閲覧者のシステムスキームに追従して
       ダーク配色へ切り替える（アプリの dark トークンと同じ slate 系）。 */
    @media (prefers-color-scheme: dark) {
      body { background: #0f172a; color: #f1f5f9; }
      .owner { color: #94a3b8; }
      .tier-row { background: #1e293b; }
      .character-image { background: #334155; }
      .character-name { color: #cbd5e1; }
    }
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

// ---- 視聴履歴の共有（issue #236） ----
// AI が URL だけで読めるよう、Markdown / 素の HTML の表で返す。

/** 視聴状態の日本語ラベル。アプリ側 lib/useWatchHistory の WATCH_STATUS_LABELS と同じ値。 */
const WATCH_STATE_LABELS: Record<string, string> = {
  WATCHING: "視聴中",
  WATCHED: "視聴済",
  ON_HOLD: "一時停止",
  STOP_WATCHING: "断念",
  WANNA_WATCH: "視聴予定",
};

const SEASON_JA: Record<string, string> = {
  winter: "冬",
  spring: "春",
  summer: "夏",
  autumn: "秋",
};

/**
 * annict_works.season_name（"2026-spring" 形式）を「2026年春」にする。
 * パースできない値はそのまま返し、どちらも無い作品は season_year に倒す。
 */
export function sharedWatchSeasonLabel(entry: {
  seasonName: string | null;
  seasonYear: number | null;
}): string {
  const match = /^(\d{4})-(\w+)$/.exec(entry.seasonName ?? "");
  const ja = match?.[2] ? SEASON_JA[match[2]] : undefined;
  if (match && ja) return `${match[1]}年${ja}`;
  if (entry.seasonName) return entry.seasonName;
  return entry.seasonYear !== null ? String(entry.seasonYear) : "-";
}

/**
 * 「最終更新日」列の日付。watch_history.updated_at を JST の YYYY-MM-DD にする。
 * 実際の視聴日時は watch_history に保持していない（Annict 側の記録日時は
 * 同期してこない）ため、ステータスの最終更新日時を出す。初回同期は
 * 全件に同期時刻が入るので「視聴日」とは名乗らない。
 * ユーザーに見せる日付なので UTC ではなく JST 基準で丸める（+9:00 固定。
 * 日本には DST が無いため単純な時差加算でよい）。
 */
export function sharedWatchDateLabel(updatedAt: Date): string {
  return new Date(updatedAt.getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

/** Markdown 表のセル用エスケープ。パイプは表を壊すため \| に、改行は潰す。 */
function escapeMarkdownCell(text: string): string {
  return text.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function buildSharedWatchHistoryMarkdown(
  history: SharedWatchHistory,
): string {
  const lines = [
    `# ${history.ownerUsername} の視聴履歴`,
    "",
    "| 作品名 | シーズン | 視聴状態 | 最終更新日 |",
    "| --- | --- | --- | --- |",
    ...history.items.map(
      (item) =>
        `| ${escapeMarkdownCell(item.title)} | ${escapeMarkdownCell(sharedWatchSeasonLabel(item))} | ${WATCH_STATE_LABELS[item.state] ?? item.state} | ${sharedWatchDateLabel(item.updatedAt)} |`,
    ),
  ];
  if (history.items.length === 0) {
    lines.push("| | | | |", "", "視聴履歴はありません。");
  }
  return `${lines.join("\n")}\n`;
}

export function buildSharedWatchHistoryHtml(
  history: SharedWatchHistory,
): string {
  const title = `${escapeHtml(history.ownerUsername)} の視聴履歴 - Animeishi`;
  const rowsHtml = history.items
    .map(
      (item) => `<tr>
      <td>${escapeHtml(item.title)}</td>
      <td>${escapeHtml(sharedWatchSeasonLabel(item))}</td>
      <td>${escapeHtml(WATCH_STATE_LABELS[item.state] ?? item.state)}</td>
      <td>${sharedWatchDateLabel(item.updatedAt)}</td>
    </tr>`,
    )
    .join("\n    ");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- ダーク閲覧時にスクロールバー等の UI クロームも追従させる -->
  <meta name="color-scheme" content="light dark" />
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(history.ownerUsername)} のアニメ視聴履歴" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${escapeHtml(history.ownerUsername)} のアニメ視聴履歴" />
  <meta property="og:type" content="website" />
  <style>
    body { font-family: sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
    .owner { color: #555; margin: 4px 0 24px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 0.9rem; }
    th { background: #f5f5f5; }
    /* アプリの盤面と同じく、閲覧者のシステムスキームに追従して
       ダーク配色へ切り替える（アプリの dark トークンと同じ slate 系）。 */
    @media (prefers-color-scheme: dark) {
      body { background: #0f172a; color: #f1f5f9; }
      .owner { color: #94a3b8; }
      th { background: #1e293b; }
      th, td { border-color: #334155; }
    }
  </style>
</head>
<body>
  <h1>${escapeHtml(history.ownerUsername)} の視聴履歴</h1>
  <p class="owner">Animeishi で共有された視聴履歴</p>
  <table>
    <thead>
      <tr><th>作品名</th><th>シーズン</th><th>視聴状態</th><th>最終更新日</th></tr>
    </thead>
    <tbody>
    ${rowsHtml}
    </tbody>
  </table>
  ${history.items.length === 0 ? "<p>視聴履歴はありません。</p>" : ""}
</body>
</html>`;
}

export function watchHistoryNotFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>視聴履歴が見つかりません - Animeishi</title>
</head>
<body>
  <h1>視聴履歴が見つかりません</h1>
  <p>この共有リンクは無効になったか、存在しません。</p>
</body>
</html>`;
}
