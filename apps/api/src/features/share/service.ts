import type { Context } from "hono";
import type { DrizzleDb } from "@/db/client";
import { escapeHtml } from "@/lib/html";
import {
  fetchFollowingRedirects,
  isPublicImageUrl,
  readBodyWithLimit,
} from "@/lib/http";
import { workImageUrl } from "@/lib/annict/workImage";
import { renderSharePage, statsHtml } from "./layout";
import { isKnownImageUrl } from "./repository";
import type {
  SharedCharacterTierList,
  SharedCustomTierList,
  SharedTierList,
  SharedWatchHistory,
  SharedWorkList,
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
 * 共有ページの正規 URL（og:url / canonical 用）。
 * ユーザーに見せる共有 URL は Web ドメイン（animeishi.uomi.dev）に統一する
 * ため、PUBLIC_WEB_URL が設定されていればリクエストのパス＋クエリをその
 * オリジンへ載せ替える（issue #408）。API ドメインの旧 URL 直撃時にも
 * canonical は Web 側を指す。未設定（preview 等）ならリクエスト URL 自身。
 */
export function buildCanonicalShareUrl(
  publicWebUrl: string | undefined,
  requestUrl: string,
): string {
  const request = new URL(requestUrl);
  if (!publicWebUrl) return request.toString();
  const base = new URL(`${publicWebUrl.replace(/\/+$/, "")}/`);
  return new URL(request.pathname + request.search, base).toString();
}

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
  item: {
    annictWorkId: number;
    resolvedImageUrl: string | null;
    imageUrl: string | null;
  },
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

/** 作品ポスター。画像が無い・読み込めないときも枠だけは残す。 */
function posterHtml(
  item: Parameters<typeof workImageHtml>[0],
  requestUrl: string,
): string {
  return `<div class="poster">${workImageHtml(item, requestUrl)}</div>`;
}

/** og:image 用の作品画像 URL。https を優先し、無ければ最初の安全な URL。 */
function pickWorkOgImage(
  items: Parameters<typeof workImageHtml>[0][],
  requestUrl: string,
): string | undefined {
  // resolvedImageUrl が不安全なら imageUrl 側も候補にする
  // （ページ上のポスター表示 workImageHtml と同じ選び方）。
  const candidates = items
    .flatMap((item) => [
      workImageUrl(requestUrl, item.annictWorkId),
      item.resolvedImageUrl,
      item.imageUrl,
    ])
    .filter((u): u is string => !!u && isSafeImageUrl(u));
  return candidates.find((u) => /^https:/i.test(u.trim())) ?? candidates[0];
}

/** tier 表（作品・キャラクター共通）の盤面スタイル。 */
const TIER_BOARD_CSS = `
    .board { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: var(--shadow); }
    .tier-row { display: flex; align-items: stretch; border-bottom: 1px solid var(--border); }
    .tier-row:last-child { border-bottom: 0; }
    .tier-label { display: flex; align-items: center; justify-content: center; width: 76px; flex-shrink: 0; padding: 8px;
      font-weight: 800; font-size: 1.1rem; text-align: center; overflow-wrap: anywhere; }
    .tier-items { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 10px; padding: 10px; flex: 1; min-height: 88px; min-width: 0; }
    .card { width: 84px; }
    .poster { width: 100%; aspect-ratio: 3 / 4; border-radius: 8px; overflow: hidden; background: var(--poster-fallback); }
    .poster img { width: 100%; height: 100%; object-fit: cover; }
    .card-title { display: -webkit-box; margin-top: 4px; font-size: 0.72rem; line-height: 1.3; color: var(--text-secondary);
      overflow: hidden; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere; }
    @media (max-width: 480px) {
      .tier-label { width: 56px; font-size: 1rem; }
      .tier-items { gap: 8px; padding: 8px; }
      .card { width: 68px; }
    }
`;

// tier.color はユーザー入力。style 属性に入るため、エスケープだけでは
// `red; position: fixed` のような宣言の追加を防げない。16 進カラー以外は既定色にする。
const TIER_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const TIER_FALLBACK_COLOR = "#e2e8f0";

function tierLabelHtml(tier: TierRow): string {
  const color = TIER_COLOR_PATTERN.test(tier.color.trim())
    ? tier.color.trim()
    : TIER_FALLBACK_COLOR;
  return `<div class="tier-label" style="background-color: ${color}; color: ${tierLabelTextColor(color)}">${escapeHtml(tier.label)}</div>`;
}

export function buildSharedTierListHtml(
  list: SharedTierList,
  requestUrl: string,
  canonicalUrl: string,
): string {
  return buildWorkTierListHtml({
    list: {
      title: list.title,
      description: list.description,
      tiersJson: list.tiersJson,
      items: list.items,
    },
    ownerLine: `${escapeHtml(list.ownerUsername)} の Tier 表（${escapeHtml(list.season)}）`,
    ownerUsername: list.ownerUsername,
    requestUrl,
    canonicalUrl,
  });
}

/**
 * 自由作成 tier 表の共有ページ。シーズン版と同じ盤面だがシーズンを持たない
 * ため、所有者行は「の Tier 表」だけにする（issue #348）。
 */
export function buildSharedCustomTierListHtml(
  list: SharedCustomTierList,
  requestUrl: string,
  canonicalUrl: string,
): string {
  return buildWorkTierListHtml({
    list: {
      title: list.title,
      description: list.description,
      tiersJson: list.tiersJson,
      items: list.items,
    },
    ownerLine: `${escapeHtml(list.ownerUsername)} の Tier 表`,
    ownerUsername: list.ownerUsername,
    requestUrl,
    canonicalUrl,
  });
}

// 作品 tier 表（シーズン版・自由作成版）で共通の共有ページ組み立て。
// 違いは所有者行の表記（シーズン併記の有無）だけなので、そこだけ引数化する。
function buildWorkTierListHtml(input: {
  list: {
    title: string;
    // 表の説明文（issue #476）。あれば所有者行の下に出す
    // （work-list の共有ページと同じ扱い）。
    description?: string | null;
    tiersJson: string;
    items: SharedTierList["items"];
  };
  ownerLine: string;
  ownerUsername: string;
  requestUrl: string;
  canonicalUrl: string;
}): string {
  const tiers = parseTiersJson(input.list.tiersJson);
  const itemsByTier = new Map<string, SharedTierList["items"]>();
  for (const item of input.list.items) {
    const arr = itemsByTier.get(item.tierKey) ?? [];
    arr.push(item);
    itemsByTier.set(item.tierKey, arr);
  }
  const placedCount = tiers.reduce(
    (sum, tier) => sum + (itemsByTier.get(tier.key)?.length ?? 0),
    0,
  );

  const rowsHtml = tiers
    .map((tier) => {
      const worksHtml = (itemsByTier.get(tier.key) ?? [])
        .map(
          (item) => `<div class="card">
        ${posterHtml(item, input.requestUrl)}
        <span class="card-title">${escapeHtml(item.title)}</span>
      </div>`,
        )
        .join("");
      return `<div class="tier-row">
      ${tierLabelHtml(tier)}
      <div class="tier-items">${worksHtml}</div>
    </div>`;
    })
    .join("\n    ");

  return renderSharePage({
    title: `${escapeHtml(input.list.title)} - Animeishi`,
    metaDescription: `${escapeHtml(input.ownerUsername)} のアニメ Tier 表`,
    canonicalUrl: input.canonicalUrl,
    // og:image には先頭の作品画像を使う。クローラは直接取得できる。
    ogImage: pickWorkOgImage(input.list.items, input.requestUrl),
    kind: "Tier 表",
    heading: escapeHtml(input.list.title),
    ownerLine: input.ownerLine,
    description: input.list.description,
    statsHtml: statsHtml([{ label: "作品", value: placedCount }]),
    bodyHtml:
      tiers.length > 0
        ? `<div class="board">
    ${rowsHtml}
  </div>`
        : `<p class="empty">Tier 表はまだありません。</p>`,
    pageCss: TIER_BOARD_CSS,
    width: "wide",
  });
}

/**
 * オリジナル作品リストの共有ページ（issue #349）。tier 行のない順位付き
 * 一覧で、説明文があれば所有者行の下に出す。
 */
export function buildSharedWorkListHtml(
  list: SharedWorkList,
  requestUrl: string,
  canonicalUrl: string,
): string {
  const itemsHtml = list.items
    .map((item) => {
      const rank = item.position + 1;
      const season =
        item.seasonName || item.seasonYear !== null
          ? `<span class="work-meta">${escapeHtml(sharedWatchSeasonLabel(item))}</span>`
          : "";
      return `<li class="rank-item">
      <span class="rank${rank <= 3 ? ` rank-${rank}` : ""}">${rank}</span>
      ${posterHtml(item, requestUrl)}
      <div class="rank-body">
        <span class="work-title">${escapeHtml(item.title)}</span>
        ${season}
      </div>
    </li>`;
    })
    .join("\n    ");

  return renderSharePage({
    title: `${escapeHtml(list.title)} - Animeishi`,
    metaDescription: `${escapeHtml(list.ownerUsername)} の作品リスト`,
    canonicalUrl,
    ogImage: pickWorkOgImage(list.items, requestUrl),
    kind: "作品リスト",
    heading: escapeHtml(list.title),
    ownerLine: `${escapeHtml(list.ownerUsername)} の作品リスト`,
    description: list.description,
    statsHtml: statsHtml([{ label: "作品", value: list.items.length }]),
    bodyHtml:
      list.items.length > 0
        ? `<ol class="ranking">
    ${itemsHtml}
  </ol>`
        : `<p class="empty">作品はまだありません。</p>`,
    pageCss: `
    .ranking { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .rank-item { display: flex; align-items: center; gap: 12px; padding: 10px 14px 10px 10px; background: var(--surface);
      border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); }
    .rank { display: flex; align-items: center; justify-content: center; flex-shrink: 0; width: 32px; height: 32px;
      border-radius: 999px; background: var(--surface-muted); color: var(--text-secondary); font-weight: 800; font-size: 0.9rem; }
    .rank-1 { background: #f59e0b; color: #ffffff; }
    .rank-2 { background: #94a3b8; color: #ffffff; }
    .rank-3 { background: #b45309; color: #ffffff; }
    .poster { flex-shrink: 0; width: 52px; aspect-ratio: 3 / 4; border-radius: 8px; overflow: hidden; background: var(--poster-fallback); }
    .poster img { width: 100%; height: 100%; object-fit: cover; }
    .rank-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .work-title { font-weight: 600; overflow-wrap: anywhere; }
    .work-meta { color: var(--text-muted); font-size: 0.8rem; }
`,
  });
}

export function workListNotFoundHtml(): string {
  return notFoundPage("作品リスト");
}

export function characterImageHtml(
  item: SharedCharacterTierList["items"][number],
): string {
  const src = item.imageUrl;
  if (!src || !isSafeImageUrl(src)) return "";
  return `<img class="character-image" src="${escapeHtml(src)}" alt="" loading="lazy" onerror="this.remove()" />`;
}

export function buildSharedCharacterTierListHtml(
  list: SharedCharacterTierList,
  canonicalUrl: string,
): string {
  const tiers = parseTiersJson(list.tiersJson);
  const itemsByTier = new Map<string, SharedCharacterTierList["items"]>();
  for (const item of list.items) {
    const arr = itemsByTier.get(item.tierKey) ?? [];
    arr.push(item);
    itemsByTier.set(item.tierKey, arr);
  }
  const placedCount = tiers.reduce(
    (sum, tier) => sum + (itemsByTier.get(tier.key)?.length ?? 0),
    0,
  );

  const rowsHtml = tiers
    .map((tier) => {
      const charactersHtml = (itemsByTier.get(tier.key) ?? [])
        .map(
          (item) => `<div class="card">
        <div class="poster">${characterImageHtml(item)}</div>
        <span class="card-title">${escapeHtml(item.name)}</span>
      </div>`,
        )
        .join("");
      return `<div class="tier-row">
      ${tierLabelHtml(tier)}
      <div class="tier-items">${charactersHtml}</div>
    </div>`;
    })
    .join("\n    ");

  return renderSharePage({
    title: `${escapeHtml(list.title)} - Animeishi`,
    metaDescription: `${escapeHtml(list.ownerUsername)} の${escapeHtml(list.workTitle)} キャラクター Tier 表`,
    canonicalUrl,
    // og:image には先頭のキャラクター画像を使う。
    ogImage: list.items
      .map((item) => item.imageUrl)
      .find((u): u is string => !!u && isSafeImageUrl(u) && /^https:/i.test(u)),
    kind: "キャラクター Tier 表",
    heading: escapeHtml(list.title),
    ownerLine: `${escapeHtml(list.ownerUsername)} の${escapeHtml(list.workTitle)} キャラクター Tier 表`,
    description: list.description,
    statsHtml: statsHtml([{ label: "キャラクター", value: placedCount }]),
    bodyHtml:
      tiers.length > 0
        ? `<div class="board">
    ${rowsHtml}
  </div>`
        : `<p class="empty">Tier 表はまだありません。</p>`,
    pageCss: TIER_BOARD_CSS,
    width: "wide",
  });
}

export function notFoundHtml(): string {
  return notFoundPage("Tier 表");
}

/** 共有リンクが無効なときのページ。kind は「Tier 表」等のプレーンテキスト。 */
function notFoundPage(kind: string): string {
  const heading = `${escapeHtml(kind)}が見つかりません`;
  return renderSharePage({
    title: `${heading} - Animeishi`,
    kind,
    heading,
    bodyHtml: `<p class="empty">この共有リンクは無効になったか、存在しません。</p>`,
  });
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

/**
 * 視聴履歴の Markdown 表。絞り込み時は、AI が部分集合を全件と取り違えない
 * よう条件と件数を見出しの下に書く。
 */
export function buildSharedWatchHistoryMarkdown(
  fullHistory: SharedWatchHistory,
  view: WatchHistoryView = { sort: "updated", state: null },
): string {
  const history = applyWatchHistoryView(fullHistory, view);
  const lines = [
    `# ${history.ownerUsername} の視聴履歴`,
    "",
    ...(view.state
      ? [
          `視聴状態「${WATCH_STATE_LABELS[view.state] ?? view.state}」で絞り込み（全 ${fullHistory.items.length} 件中 ${history.items.length} 件）`,
          "",
        ]
      : []),
    "| 作品名 | シーズン | 視聴状態 | 最終更新日 |",
    "| --- | --- | --- | --- |",
    ...history.items.map(
      (item) =>
        `| ${escapeMarkdownCell(item.title)} | ${escapeMarkdownCell(sharedWatchSeasonLabel(item))} | ${WATCH_STATE_LABELS[item.state] ?? item.state} | ${sharedWatchDateLabel(item.updatedAt)} |`,
    ),
  ];
  if (history.items.length === 0) {
    lines.push(
      "| | | | |",
      "",
      fullHistory.items.length === 0
        ? "視聴履歴はありません。"
        : "条件に合う作品はありません。",
    );
  }
  return `${lines.join("\n")}\n`;
}

// ---- 視聴履歴の並び替え・絞り込み（issue #518） ----
// 共有ページは JS を使わないため、クエリパラメータ（?sort= / ?state=）で
// 受け取ってサーバ側で並べ直す。Markdown 応答にも同じ条件を適用する。

/** 絞り込みチップの並び（アプリの視聴ステータスと同じ集合）。 */
const WATCH_STATE_ORDER = [
  "WATCHING",
  "WATCHED",
  "WANNA_WATCH",
  "ON_HOLD",
  "STOP_WATCHING",
] as const;
type SharedWatchState = (typeof WATCH_STATE_ORDER)[number];

const WATCH_HISTORY_SORTS = {
  updated: "更新順",
  added_desc: "追加が新しい順",
  added_asc: "追加が古い順",
  year_desc: "放送年が新しい順",
  year_asc: "放送年が古い順",
} as const;
export type WatchHistorySort = keyof typeof WATCH_HISTORY_SORTS;

export type WatchHistoryView = {
  sort: WatchHistorySort;
  /** null は「すべて」。 */
  state: SharedWatchState | null;
};

/**
 * クエリから並び替え・絞り込み条件を読む。公開ページなので不正な値は
 * 400 にせず既定（更新順・すべて）に倒す。
 */
export function parseWatchHistoryView(query: {
  sort?: string | undefined;
  state?: string | undefined;
}): WatchHistoryView {
  const sort =
    query.sort && Object.hasOwn(WATCH_HISTORY_SORTS, query.sort)
      ? (query.sort as WatchHistorySort)
      : "updated";
  const state = WATCH_STATE_ORDER.find((s) => s === query.state) ?? null;
  return { sort, state };
}

const SEASON_ORDER: Record<string, number> = {
  winter: 0,
  spring: 1,
  summer: 2,
  autumn: 3,
};

/**
 * 年度順の並びキー。season_year が無くても season_name（"2026-spring"）から
 * 年を補う。放送時期が分からない作品は null（昇順・降順とも末尾に置く）。
 */
function seasonSortKey(entry: {
  seasonName: string | null;
  seasonYear: number | null;
}): number | null {
  const match = /^(\d{4})-(\w+)$/.exec(entry.seasonName ?? "");
  const year = entry.seasonYear ?? (match?.[1] ? Number(match[1]) : null);
  if (year === null) return null;
  const season = match?.[2] ? (SEASON_ORDER[match[2]] ?? 0) : 0;
  return year * 4 + season;
}

/**
 * 条件に合わせて絞り込み・並べ替えた履歴を返す。入力は更新日時の降順
 * （repository の既定順）を前提とし、同順位はその順を保つ。
 */
export function applyWatchHistoryView(
  history: SharedWatchHistory,
  view: WatchHistoryView,
): SharedWatchHistory {
  const filtered = view.state
    ? history.items.filter((item) => item.state === view.state)
    : [...history.items];
  if (view.sort === "added_desc" || view.sort === "added_asc") {
    const direction = view.sort === "added_desc" ? -1 : 1;
    filtered.sort((a, b) => (a.entryId - b.entryId) * direction);
  } else if (view.sort === "year_desc" || view.sort === "year_asc") {
    const direction = view.sort === "year_desc" ? -1 : 1;
    filtered.sort((a, b) => {
      const ka = seasonSortKey(a);
      const kb = seasonSortKey(b);
      if (ka === kb) return 0;
      if (ka === null) return 1;
      if (kb === null) return -1;
      return (ka - kb) * direction;
    });
  }
  return { ...history, items: filtered };
}

/** 条件を反映した相対リンク。既定値のパラメータは省く。 */
function watchHistoryViewHref(view: WatchHistoryView): string {
  const params = new URLSearchParams();
  if (view.state) params.set("state", view.state);
  if (view.sort !== "updated") params.set("sort", view.sort);
  return escapeHtml(`?${params.toString()}`);
}

function chipHtml(
  label: string,
  href: string,
  current: boolean,
  count?: number,
) {
  return `<a class="chip" href="${href}"${current ? ` aria-current="page"` : ""}>${escapeHtml(label)}${count !== undefined ? ` <span class="chip-count">${count}</span>` : ""}</a>`;
}

const STATE_CLASS: Record<string, string> = {
  WATCHING: "state-watching",
  WATCHED: "state-watched",
  WANNA_WATCH: "state-wanna",
  ON_HOLD: "state-hold",
  STOP_WATCHING: "state-stop",
};

/**
 * 視聴履歴の共有ページ（issue #461 / #518）。表データ（作品名・シーズン・
 * 視聴状態・最終更新日）は AI の機械可読のため table のまま DOM に残し
 * （issue #236）、表示だけ CSS でカード風のリストにしている。thead も消さず
 * 視覚的にだけ隠す。history は絞り込み前の全件を渡す（チップの件数に使う）。
 */
export function buildSharedWatchHistoryHtml(
  history: SharedWatchHistory,
  requestUrl: string,
  canonicalUrl: string,
  view: WatchHistoryView = { sort: "updated", state: null },
): string {
  const visible = applyWatchHistoryView(history, view).items;

  const counts = new Map<string, number>();
  for (const item of history.items) {
    counts.set(item.state, (counts.get(item.state) ?? 0) + 1);
  }

  const stateChips = [
    chipHtml(
      "すべて",
      watchHistoryViewHref({ ...view, state: null }),
      view.state === null,
      history.items.length,
    ),
    ...WATCH_STATE_ORDER.map((state) =>
      chipHtml(
        WATCH_STATE_LABELS[state] ?? state,
        watchHistoryViewHref({ ...view, state }),
        view.state === state,
        counts.get(state) ?? 0,
      ),
    ),
  ].join("");
  const sortChips = (Object.keys(WATCH_HISTORY_SORTS) as WatchHistorySort[])
    .map((sort) =>
      chipHtml(
        WATCH_HISTORY_SORTS[sort],
        watchHistoryViewHref({ ...view, sort }),
        view.sort === sort,
      ),
    )
    .join("");

  const rowsHtml = visible
    .map(
      (item) => `<tr>
      <td class="cell-work">${posterHtml(item, requestUrl)}<span class="work-title">${escapeHtml(item.title)}</span></td>
      <td class="cell-meta">${escapeHtml(sharedWatchSeasonLabel(item))}</td>
      <td><span class="state ${STATE_CLASS[item.state] ?? ""}">${escapeHtml(WATCH_STATE_LABELS[item.state] ?? item.state)}</span></td>
      <td class="cell-meta">${sharedWatchDateLabel(item.updatedAt)}</td>
    </tr>`,
    )
    .join("\n    ");

  const emptyMessage =
    history.items.length === 0
      ? "視聴履歴はありません。"
      : "条件に合う作品はありません。";

  return renderSharePage({
    title: `${escapeHtml(history.ownerUsername)} の視聴履歴 - Animeishi`,
    metaDescription: `${escapeHtml(history.ownerUsername)} のアニメ視聴履歴`,
    canonicalUrl,
    // og:image にプロキシ URL を使わない。プロキシ URL は画像の有無に関わらず
    // 生成されるため先頭作品の画像が 404 だと OGP 画像自体が欠落する。
    // 代わりに DB の外部画像 URL を持つ最初の作品から選ぶ（候補の優先順は
    // resolvedImageUrl → imageUrl。どれも無ければ og:image を出さない）。
    ogImage: history.items
      .flatMap((item) => [item.resolvedImageUrl, item.imageUrl])
      .find(
        (u): u is string =>
          !!u && isSafeImageUrl(u) && /^https:/i.test(u.trim()),
      ),
    kind: "視聴履歴",
    heading: `${escapeHtml(history.ownerUsername)} の視聴履歴`,
    ownerLine: "Animeishi で共有された視聴履歴",
    statsHtml: statsHtml([
      { label: "作品", value: history.items.length },
      { label: "視聴済", value: counts.get("WATCHED") ?? 0 },
      { label: "視聴中", value: counts.get("WATCHING") ?? 0 },
    ]),
    bodyHtml: `<nav class="controls" aria-label="絞り込みと並び替え">
    <div class="control-group"><span class="control-label">ステータス</span><div class="chips">${stateChips}</div></div>
    <div class="control-group"><span class="control-label">並び順</span><div class="chips">${sortChips}</div></div>
  </nav>
  <p class="result-count">${visible.length} 件</p>
  <table>
    <thead>
      <tr><th>作品名</th><th>シーズン</th><th>視聴状態</th><th>最終更新日</th></tr>
    </thead>
    <tbody>
    ${rowsHtml}
    </tbody>
  </table>
  ${visible.length === 0 ? `<p class="empty">${emptyMessage}</p>` : ""}`,
    pageCss: `
    .controls { display: flex; flex-direction: column; gap: 10px; padding: 14px; background: var(--surface);
      border: 1px solid var(--border); border-radius: 14px; box-shadow: var(--shadow); }
    .control-group { display: flex; align-items: baseline; gap: 10px; }
    .control-label { flex-shrink: 0; width: 5.5em; color: var(--text-muted); font-size: 0.75rem; font-weight: 600; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { display: inline-flex; align-items: center; gap: 4px; padding: 5px 12px; border-radius: 999px;
      border: 1px solid var(--border); background: var(--surface-muted); color: var(--text-secondary);
      font-size: 0.8rem; font-weight: 600; text-decoration: none; white-space: nowrap; }
    .chip:hover { border-color: var(--primary-border); }
    .chip[aria-current] { background: var(--primary); border-color: var(--primary); color: #ffffff; }
    .chip-count { font-weight: 500; opacity: 0.75; font-size: 0.72rem; }
    .result-count { margin: 16px 2px 8px; color: var(--text-muted); font-size: 0.8rem; }
    @media (max-width: 480px) {
      .control-group { flex-direction: column; gap: 6px; }
    }
    table { display: block; width: 100%; border-collapse: collapse; }
    thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
    tbody { display: flex; flex-direction: column; gap: 8px; }
    tr { display: flex; flex-wrap: wrap; align-items: center; column-gap: 12px; row-gap: 6px; padding: 10px 14px 10px 10px;
      border-radius: 14px; background: var(--surface); border: 1px solid var(--border); box-shadow: var(--shadow); }
    td { padding: 0; }
    .cell-work { flex: 1 1 240px; display: flex; align-items: center; gap: 12px; min-width: 0; }
    .poster { flex-shrink: 0; width: 48px; aspect-ratio: 3 / 4; border-radius: 8px; overflow: hidden; background: var(--poster-fallback); }
    .poster img { width: 100%; height: 100%; object-fit: cover; }
    .work-title { font-weight: 600; overflow-wrap: anywhere; }
    .cell-meta { color: var(--text-muted); font-size: 0.8rem; white-space: nowrap; }
    .state { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 0.75rem; font-weight: 700; white-space: nowrap;
      background: var(--primary-soft); color: var(--primary-text); }
    .state-watching { background: #dbeafe; color: #1d4ed8; }
    .state-watched { background: #dcfce7; color: #15803d; }
    .state-hold { background: #fef3c7; color: #b45309; }
    .state-stop { background: #f1f5f9; color: #475569; }
    @media (prefers-color-scheme: dark) {
      .state-watching { background: #1e3a8a; color: #bfdbfe; }
      .state-watched { background: #14532d; color: #bbf7d0; }
      .state-hold { background: #78350f; color: #fde68a; }
      .state-stop { background: #334155; color: #cbd5e1; }
    }
`,
  });
}

export function watchHistoryNotFoundHtml(): string {
  return notFoundPage("視聴履歴");
}
