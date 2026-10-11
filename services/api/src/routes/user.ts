import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { users, userGenres } from "@/db/schema";
import { escapeHtml } from "@/lib/html";
import { authorizedDb } from "@/repository/authorizedDb";
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
    const db = createDb(c.env.DB as D1Database);
    const wantsHtml = (c.req.header("Accept") ?? "").includes("text/html");
    // Accept で HTML / JSON を出し分けるため、すべての応答に Vary を付ける。
    c.header("Vary", "Accept");

    // ブロックは双方向で効かせる（自分がブロックした相手も、
    // 自分をブロックした相手も閲覧不可）。404 で返してブロックの有無を窺えないようにする。
    const viewerId = c.get("clerkUserId");
    if (viewerId && viewerId !== uid) {
      const blocked = await authorizedDb(db, viewerId).isBlockedWith(uid);
      if (blocked) {
        if (wantsHtml) {
          return c.html(notFoundHtml(), 404);
        }
        return c.json({ error: "User not found" }, 404);
      }
    }

    const profile = await db.query.users.findFirst({
      where: eq(users.id, uid),
    });

    if (!profile || !profile.isPublic) {
      if (wantsHtml) {
        return c.html(notFoundHtml(), 404);
      }
      return c.json({ error: "User not found" }, 404);
    }

    const genres = await db.query.userGenres.findMany({
      where: eq(userGenres.userId, uid),
    });
    const genreList = genres.map((g) => g.genre);

    if (wantsHtml) {
      const webProfileUrl = buildWebProfileUrl(
        c.env.PUBLIC_WEB_URL,
        c.req.url,
        profile.id,
      );
      const html = buildOgpHtml(profile, genreList, webProfileUrl);
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
      },
      200,
    );
  });

/**
 * 「Web で見る」導線の URL を組み立てる。
 * PUBLIC_WEB_URL があれば `${base}/user/<id>`、なければこのページ自身の
 * オリジン + `/user/<id>`（API が返すこの HTML が実質 Web 版なので
 * 自己参照で問題ない）にフォールバックする。
 */
function buildWebProfileUrl(
  publicWebUrl: string | undefined,
  requestUrl: string,
  userId: string,
): string {
  const base = (publicWebUrl ?? new URL(requestUrl).origin).replace(/\/+$/, "");
  return `${base}/user/${encodeURIComponent(userId)}`;
}

function buildOgpHtml(
  profile: {
    id: string;
    username: string;
    bio: string | null;
    favoriteQuote: string | null;
    profileImageUrl: string | null;
  },
  genres: string[],
  webProfileUrl: string,
): string {
  const title = `${escapeHtml(profile.username)} - Animeishi`;
  const description = profile.bio
    ? escapeHtml(profile.bio)
    : `${escapeHtml(profile.username)} のアニメプロフィール`;
  const image = profile.profileImageUrl
    ? escapeHtml(profile.profileImageUrl)
    : "";
  const genreText =
    genres.length > 0 ? escapeHtml(genres.join("・")) : "未設定";
  const quoteText = profile.favoriteQuote
    ? escapeHtml(profile.favoriteQuote)
    : "";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="profile" />
  ${image ? `<meta property="og:image" content="${image}" />` : ""}
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  ${image ? `<meta name="twitter:image" content="${image}" />` : ""}
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
    .avatar { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; }
    .username { font-size: 1.5rem; font-weight: bold; margin: 16px 0 4px; }
    .bio { color: #555; margin: 8px 0; }
    .quote { border-left: 3px solid #e0a; padding-left: 12px; color: #777; margin: 12px 0; font-style: italic; }
    .genres { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .genre { background: #f0f0f0; border-radius: 12px; padding: 2px 10px; font-size: 0.85rem; }
    .app-link { display: inline-block; margin-top: 24px; padding: 10px 20px; background: #7c3aed; color: #fff; border-radius: 8px; text-decoration: none; }
    .web-link { margin-top: 12px; font-size: 0.9rem; color: #666; }
    .web-link a { color: #7c3aed; }
  </style>
</head>
<body>
  ${image ? `<img class="avatar" src="${image}" alt="${escapeHtml(profile.username)}" />` : ""}
  <div class="username">${escapeHtml(profile.username)}</div>
  ${profile.bio ? `<p class="bio">${escapeHtml(profile.bio)}</p>` : ""}
  ${quoteText ? `<blockquote class="quote">${quoteText}</blockquote>` : ""}
  <div class="genres">
    ${genres.map((g) => `<span class="genre">${escapeHtml(g)}</span>`).join("")}
    ${genres.length === 0 ? `<span class="genre">${genreText}</span>` : ""}
  </div>
  <a class="app-link" href="animeishi://user/${escapeHtml(profile.id)}">アプリで見る</a>
  <p class="web-link">アプリをお持ちでない方は <a href="${escapeHtml(webProfileUrl)}">Web 版で見る</a></p>
</body>
</html>`;
}

function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>ユーザーが見つかりません - Animeishi</title>
</head>
<body>
  <h1>ユーザーが見つかりません</h1>
  <p>このプロフィールは存在しないか、非公開に設定されています。</p>
</body>
</html>`;
}

export { user };
