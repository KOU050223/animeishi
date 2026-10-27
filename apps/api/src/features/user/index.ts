import { Hono } from "hono";
import { createDb } from "@/db/client";
import {
  findUserById,
  findUserGenres,
  usersRepository,
} from "../users/repository";
import { findUserWatchSummary } from "./repository";
import { buildOgpHtml, buildWebProfileUrl, notFoundHtml } from "./service";
import { optionalAuth } from "@/middleware/auth";
import type { Env } from "@/db/client";

type UserRouteEnv = {
  Bindings: Env & { DB: D1Database } & {
    CLERK_SECRET_KEY?: string;
    CLERK_PUBLISHABLE_KEY?: string;
    // Web 版プロフィールのベース URL（例: https://animeishi.uomi.dev）。
    // OGP HTML の「Web で見る」導線に使う。未設定時はリクエスト先自身の
    // オリジン（= この HTML ページ）にフォールバックする。
    PUBLIC_WEB_URL?: string;
  };
  Variables: {
    clerkUserId?: string;
  };
};

const user = new Hono<UserRouteEnv>()
  // 公開エンドポイントだが、サインイン済みなら誰が見ているかを拾う。
  // ブロック関係にある相手の名刺を見せないために必要。
  .use("*", optionalAuth)
  .get("/:uid", async (c) => {
    const uid = c.req.param("uid");
    const db = createDb(c.env.DB);
    const wantsHtml = (c.req.header("Accept") ?? "").includes("text/html");
    // Accept で HTML / JSON を出し分けるため、すべての応答に Vary を付ける。
    c.header("Vary", "Accept");

    // ブロックは双方向で効かせる（自分がブロックした相手も、
    // 自分をブロックした相手も閲覧不可）。404 で返してブロックの有無を窺えないようにする。
    const viewerId = c.get("clerkUserId");
    if (viewerId && viewerId !== uid) {
      const blocked = await usersRepository(db, viewerId).isBlockedWith(uid);
      if (blocked) {
        if (wantsHtml) {
          return c.html(notFoundHtml(), 404);
        }
        return c.json({ error: "User not found" }, 404);
      }
    }

    const profile = await findUserById(db, uid);

    if (!profile || !profile.isPublic) {
      if (wantsHtml) {
        return c.html(notFoundHtml(), 404);
      }
      return c.json({ error: "User not found" }, 404);
    }

    const genreList = await findUserGenres(db, uid);
    // 視聴サマリは D1 キャッシュ（本人が最後に一覧を開いた時点の
    // スナップショット）からの集計（issue #65）。公開・非ブロックが
    // 確認できた後にだけ集計する。
    const watchSummary = await findUserWatchSummary(db, uid);

    if (wantsHtml) {
      const webProfileUrl = buildWebProfileUrl(
        c.env.PUBLIC_WEB_URL,
        c.req.url,
        profile.id,
      );
      const html = buildOgpHtml(
        profile,
        genreList,
        watchSummary,
        webProfileUrl,
      );
      // ブロック判定が閲覧者依存なので共有キャッシュには載せない（private）。
      return c.html(html, 200, {
        "Cache-Control": "private, max-age=60",
      });
    }

    return c.json(
      {
        id: profile.id,
        username: profile.username,
        bio: profile.bio,
        favoriteQuote: profile.favoriteQuote,
        profileImageUrl: profile.profileImageUrl,
        genres: genreList,
        watchSummary,
      },
      200,
    );
  });

export { user };
