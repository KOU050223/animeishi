import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createDb } from "@/db/client";
import type { Env } from "@/db/client";
import {
  getSharedCharacterTierList,
  getSharedCustomTierList,
  getSharedTierList,
  getSharedWatchHistory,
  getSharedWorkList,
} from "./repository";
import { shareTokenParamSchema } from "./schema";
import {
  buildCanonicalShareUrl,
  buildSharedCharacterTierListHtml,
  buildSharedCustomTierListHtml,
  buildSharedTierListHtml,
  buildSharedWatchHistoryHtml,
  buildSharedWatchHistoryMarkdown,
  buildSharedWorkListHtml,
  notFoundHtml,
  parseTiersJson,
  parseWatchHistoryView,
  proxyImage,
  watchHistoryNotFoundHtml,
  workListNotFoundHtml,
} from "./service";
import { workImageUrl } from "@/lib/annict/workImage";
import type { GuestCtaSource } from "@animeishi/observability";

// 共有ページの登録 CTA の表示を Workers Logs に残す（issue #217 / #562）。
// ページ自体は JS を持たない（issue #236）ため、HTML を返した時点を表示とみなす。
// タップは遷移先（Web 版の新規登録画面）が Sentry Logs の guest_cta_tap で送る。
function logGuestCtaView(source: GuestCtaSource): void {
  console.log(
    JSON.stringify({ level: "info", event: "guest_cta_view", source }),
  );
}

type ShareBindings = {
  Bindings: Env & { DB: D1Database } & {
    // 共有ページの og:url / canonical に使う Web 版のベース URL
    // （例: https://animeishi.uomi.dev。issue #408）。未設定時は
    // リクエスト URL 自身を正規 URL とする。
    PUBLIC_WEB_URL?: string;
    // /share/image-proxy が自前の作品画像 URL（/images/works/:id）を
    // 内部解決するときに使う（issue #636）。wrangler.toml で全環境に
    // バインド済みだが、未バインドでも従来の DB 照合だけは機能するよう
    // 省略可にしておく。
    AVATARS?: R2Bucket;
    // MAL API の Client ID（Workers Secret。issue #238）。serveWorkImage
    // の再解決にそのまま渡す。未設定なら MAL は使わない。
    MAL_CLIENT_ID?: string;
  };
};

const share = new Hono<ShareBindings>()
  .get(
    "/tier-lists/:token",
    zValidator("param", shareTokenParamSchema),
    async (c) => {
      const { token } = c.req.valid("param");
      const db = createDb(c.env.DB);
      const list = await getSharedTierList(db, token);
      const wantsHtml = (c.req.header("Accept") ?? "").includes("text/html");

      if (!list) {
        if (wantsHtml) return c.html(notFoundHtml(), 404);
        return c.json({ error: "Shared tier list not found" }, 404);
      }

      if (wantsHtml) {
        logGuestCtaView("share_tier_list");
        // 共有解除で無効化されるコンテンツなのでキャッシュさせない。
        // public キャッシュを許すと、解除後も CDN/ブラウザが古いページを
        // 返し続ける可能性がある。
        return c.html(
          buildSharedTierListHtml(
            list,
            c.req.url,
            buildCanonicalShareUrl(c.env.PUBLIC_WEB_URL, c.req.url),
          ),
          200,
          {
            "Cache-Control": "no-store",
          },
        );
      }

      return c.json(
        {
          title: list.title,
          description: list.description,
          season: list.season,
          tiers: parseTiersJson(list.tiersJson),
          owner: { username: list.ownerUsername },
          // 作品画像プロキシの URL（GET /images/works/:id）を載せる。
          items: list.items.map((item) => ({
            ...item,
            hostedImageUrl: workImageUrl(c.req.url, item.annictWorkId),
          })),
        },
        200,
      );
    },
  )
  // キャラクター tier 表の共有リンク（issue #169）。作品版と同じく
  // ブラウザには OGP 付き HTML、JSON クライアントには構造化データを返す。
  .get(
    "/character-tier-lists/:token",
    zValidator("param", shareTokenParamSchema),
    async (c) => {
      const { token } = c.req.valid("param");
      const db = createDb(c.env.DB);
      const list = await getSharedCharacterTierList(db, token);
      const wantsHtml = (c.req.header("Accept") ?? "").includes("text/html");

      if (!list) {
        if (wantsHtml) return c.html(notFoundHtml(), 404);
        return c.json({ error: "Shared tier list not found" }, 404);
      }

      if (wantsHtml) {
        logGuestCtaView("share_character_tier_list");
        return c.html(
          buildSharedCharacterTierListHtml(
            list,
            buildCanonicalShareUrl(c.env.PUBLIC_WEB_URL, c.req.url),
          ),
          200,
          {
            "Cache-Control": "no-store",
          },
        );
      }

      return c.json(
        {
          title: list.title,
          description: list.description,
          annictWorkId: list.annictWorkId,
          workTitle: list.workTitle,
          tiers: parseTiersJson(list.tiersJson),
          owner: { username: list.ownerUsername },
          items: list.items,
        },
        200,
      );
    },
  )
  // 自由作成 tier 表の共有リンク（issue #348）。シーズン版と同じく
  // ブラウザには OGP 付き HTML、JSON クライアントには構造化データを返す。
  // スコープキー（season）を持たないので JSON には season を含めない。
  .get(
    "/custom-tier-lists/:token",
    zValidator("param", shareTokenParamSchema),
    async (c) => {
      const { token } = c.req.valid("param");
      const db = createDb(c.env.DB);
      const list = await getSharedCustomTierList(db, token);
      const wantsHtml = (c.req.header("Accept") ?? "").includes("text/html");

      if (!list) {
        if (wantsHtml) return c.html(notFoundHtml(), 404);
        return c.json({ error: "Shared tier list not found" }, 404);
      }

      if (wantsHtml) {
        logGuestCtaView("share_custom_tier_list");
        return c.html(
          buildSharedCustomTierListHtml(
            list,
            c.req.url,
            buildCanonicalShareUrl(c.env.PUBLIC_WEB_URL, c.req.url),
          ),
          200,
          {
            "Cache-Control": "no-store",
          },
        );
      }

      return c.json(
        {
          title: list.title,
          description: list.description,
          tiers: parseTiersJson(list.tiersJson),
          owner: { username: list.ownerUsername },
          items: list.items.map((item) => ({
            ...item,
            hostedImageUrl: workImageUrl(c.req.url, item.annictWorkId),
          })),
        },
        200,
      );
    },
  )
  // オリジナル作品リストの共有リンク（issue #349）。tier 表と同じく
  // ブラウザには OGP 付き HTML、JSON クライアントには構造化データを返す。
  .get(
    "/work-lists/:token",
    zValidator("param", shareTokenParamSchema),
    async (c) => {
      const { token } = c.req.valid("param");
      const db = createDb(c.env.DB);
      const list = await getSharedWorkList(db, token);
      const wantsHtml = (c.req.header("Accept") ?? "").includes("text/html");

      if (!list) {
        if (wantsHtml) return c.html(workListNotFoundHtml(), 404);
        return c.json({ error: "Shared work list not found" }, 404);
      }

      if (wantsHtml) {
        logGuestCtaView("share_work_list");
        return c.html(
          buildSharedWorkListHtml(
            list,
            c.req.url,
            buildCanonicalShareUrl(c.env.PUBLIC_WEB_URL, c.req.url),
          ),
          200,
          {
            "Cache-Control": "no-store",
          },
        );
      }

      return c.json(
        {
          title: list.title,
          description: list.description,
          owner: { username: list.ownerUsername },
          items: list.items.map((item) => ({
            ...item,
            hostedImageUrl: workImageUrl(c.req.url, item.annictWorkId),
          })),
        },
        200,
        // 共有解除後に中間キャッシュへ残さないため、HTML と同じく
        // JSON にも保存を許さない（tier 表の共有と同じ考え方）。
        { "Cache-Control": "no-store" },
      );
    },
  )
  // 視聴履歴の共有リンク（issue #236）。AI が URL だけで読めるよう、
  // Accept: text/markdown / text/plain には Markdown の表を、ブラウザには
  // JS なしの素の HTML を返す。どちらにも当てはまらない Accept（*/* 等）も
  // AI 用途を優先して Markdown に倒す。
  .get(
    "/watch-history/:token",
    zValidator("param", shareTokenParamSchema),
    async (c) => {
      const { token } = c.req.valid("param");
      const db = createDb(c.env.DB);
      const history = await getSharedWatchHistory(db, token);
      const accept = c.req.header("Accept") ?? "";
      const wantsHtml =
        !accept.includes("text/markdown") &&
        !accept.includes("text/plain") &&
        accept.includes("text/html");

      if (!history) {
        if (wantsHtml) return c.html(watchHistoryNotFoundHtml(), 404);
        return c.json({ error: "Shared watch history not found" }, 404);
      }

      // 共有解除で無効化されるコンテンツなのでキャッシュさせない
      // （/share/tier-lists と同じ方針）。
      const headers = { "Cache-Control": "no-store" };
      // 並び替え・絞り込み（issue #518）。canonical は条件を外した URL にする。
      const view = parseWatchHistoryView({
        sort: c.req.query("sort"),
        state: c.req.query("state"),
      });
      if (wantsHtml) {
        logGuestCtaView("share_watch_history");
        const canonicalSource = new URL(c.req.url);
        canonicalSource.search = "";
        return c.html(
          buildSharedWatchHistoryHtml(
            history,
            c.req.url,
            buildCanonicalShareUrl(
              c.env.PUBLIC_WEB_URL,
              canonicalSource.toString(),
            ),
            view,
          ),
          200,
          headers,
        );
      }
      const contentType = accept.includes("text/plain")
        ? "text/plain; charset=utf-8"
        : "text/markdown; charset=utf-8";
      const markdown = buildSharedWatchHistoryMarkdown(history, view);
      return c.body(markdown, 200, {
        ...headers,
        "Content-Type": contentType,
      });
    },
  )
  .get(
    "/image-proxy",
    zValidator("query", z.object({ url: z.string().min(1).max(2048) })),
    async (c) => {
      const { url } = c.req.valid("query");
      const db = createDb(c.env.DB);
      return proxyImage(c, db, url, {
        bucket: c.env.AVATARS,
        malClientId: c.env.MAL_CLIENT_ID,
      });
    },
  );

export { share };
