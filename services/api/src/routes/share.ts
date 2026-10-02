import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createDb } from "@/db/client";
import type { Env } from "@/db/client";
import { escapeHtml } from "@/lib/html";
import { getSharedTierList } from "@/repository/sharedTierLists";
import type { SharedTierList } from "@/repository/sharedTierLists";

type ShareBindings = {
  Bindings: Env & { DB: D1Database };
};

const shareTokenParamSchema = z.object({
  token: z.string().min(1).max(128),
});

type TierRow = { key: string; label: string; color: string };

/**
 * tiers_json（ユーザー定義の行）の防御的パース。
 * 壊れていても共有ページ自体は開けるよう、不正なら空配列に落とす。
 */
function parseTiersJson(json: string): TierRow[] {
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
const share = new Hono<ShareBindings>().get(
  "/tier-lists/:token",
  zValidator("param", shareTokenParamSchema),
  async (c) => {
    const { token } = c.req.valid("param");
    const db = createDb(c.env.DB as D1Database);
    const list = await getSharedTierList(db, token);
    const wantsHtml = (c.req.header("Accept") ?? "").includes("text/html");

    if (!list) {
      if (wantsHtml) return c.html(notFoundHtml(), 404);
      return c.json({ error: "Shared tier list not found" }, 404);
    }

    if (wantsHtml) {
      return c.html(buildSharedTierListHtml(list), 200, {
        "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
      });
    }

    return c.json(
      {
        title: list.title,
        season: list.season,
        tiers: parseTiersJson(list.tiersJson),
        owner: { username: list.ownerUsername },
        items: list.items,
      },
      200,
    );
  },
);

/**
 * 公開 HTML の <img src> に入れてよい URL か。
 * 作品メタは外部データ由来なので、http(s) 以外のスキーム（data: 等）は
 * 属性エスケープだけでは表示先を制限できない。ここで絞る。
 */
function isSafeImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url.trim());
}

function workImageHtml(item: SharedTierList["items"][number]): string {
  const src = item.resolvedImageUrl ?? item.imageUrl;
  if (!src || !isSafeImageUrl(src)) return "";
  return `<img class="work-image" src="${escapeHtml(src)}" alt="" loading="lazy" />`;
}

function buildSharedTierListHtml(list: SharedTierList): string {
  const tiers = parseTiersJson(list.tiersJson);
  const itemsByTier = new Map<string, SharedTierList["items"]>();
  for (const item of list.items) {
    const arr = itemsByTier.get(item.tierKey) ?? [];
    arr.push(item);
    itemsByTier.set(item.tierKey, arr);
  }

  const title = `${escapeHtml(list.title)} - Animeishi`;
  const description = `${escapeHtml(list.ownerUsername)} のアニメ Tier 表`;

  const rowsHtml = tiers
    .map((tier) => {
      const works = itemsByTier.get(tier.key) ?? [];
      const worksHtml = works
        .map(
          (item) => `<div class="work">
      ${workImageHtml(item)}
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
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <style>
    body { font-family: sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
    .owner { color: #555; margin: 4px 0 24px; }
    .tier-row { display: flex; align-items: stretch; margin-bottom: 8px; border-radius: 8px; overflow: hidden; background: #f5f5f5; }
    .tier-label { display: flex; align-items: center; justify-content: center; min-width: 64px; padding: 8px; font-weight: bold; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,.4); }
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

function notFoundHtml(): string {
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

export { share };
