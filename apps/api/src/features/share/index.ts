import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { createDb } from "@/db/client";
import type { Env } from "@/db/client";
import { getSharedCharacterTierList, getSharedTierList } from "./repository";
import { shareTokenParamSchema } from "./schema";
import {
  buildSharedCharacterTierListHtml,
  buildSharedTierListHtml,
  notFoundHtml,
  parseTiersJson,
  proxyImage,
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
