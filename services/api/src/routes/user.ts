import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { createDb } from "@/db/client";
import { users, userGenres } from "@/db/schema";
import type { Env } from "@/db/client";

type UserBindings = {
  Bindings: Env & { DB: D1Database };
};

const user = new Hono<UserBindings>().get("/:uid", async (c) => {
  const uid = c.req.param("uid");
  const db = createDb(c.env.DB as D1Database);
  const wantsHtml = (c.req.header("Accept") ?? "").includes("text/html");

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
    const html = buildOgpHtml(profile, genreList);
    return c.html(html, 200, {
      "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
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

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
