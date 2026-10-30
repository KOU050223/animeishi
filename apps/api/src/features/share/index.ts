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
  buildSharedCharacterTierListHtml,
  buildSharedCustomTierListHtml,
  buildSharedTierListHtml,
  buildSharedWatchHistoryHtml,
  buildSharedWatchHistoryMarkdown,
  buildSharedWorkListHtml,
  notFoundHtml,
  parseTiersJson,
  proxyImage,
  watchHistoryNotFoundHtml,
  workListNotFoundHtml,
} from "./service";
import { workImageUrl } from "@/lib/annict/workImage";

type ShareBindings = {
  Bindings: Env & { DB: D1Database };
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
        // 共有解除で無効化されるコンテンツなのでキャッシュさせない。
        // public キャッシュを許すと、解除後も CDN/ブラウザが古いページを
        // 返し続ける可能性がある。
        return c.html(buildSharedTierListHtml(list, c.req.url), 200, {
          "Cache-Control": "no-store",
        });
      }

      return c.json(
        {
          title: list.title,
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
        return c.html(buildSharedCharacterTierListHtml(list), 200, {
          "Cache-Control": "no-store",
        });
      }

      return c.json(
        {
          title: list.title,
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
        return c.html(buildSharedCustomTierListHtml(list, c.req.url), 200, {
          "Cache-Control": "no-store",
        });
      }

      return c.json(
        {
          title: list.title,
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
        return c.html(buildSharedWorkListHtml(list, c.req.url), 200, {
          "Cache-Control": "no-store",
        });
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
      if (wantsHtml) {
        return c.html(buildSharedWatchHistoryHtml(history), 200, headers);
      }
      const contentType = accept.includes("text/plain")
        ? "text/plain; charset=utf-8"
        : "text/markdown; charset=utf-8";
      return c.body(buildSharedWatchHistoryMarkdown(history), 200, {
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
      return proxyImage(c, db, url);
    },
  );

export { share };
