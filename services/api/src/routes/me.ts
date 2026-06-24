import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { profileUpdateSchema } from "@/schema/validators";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";

type MeBindings = Omit<AuthEnv["Bindings"], "DB"> & {
  DB: D1Database;
  // プロフィール画像（アバター）保存用 R2 バケット
  AVATARS: R2Bucket;
};

function getBindings(c: Context): MeBindings {
  return c.env as MeBindings;
}

// アバターとして許可する画像形式と拡張子の対応。
// モバイル側は WebP に圧縮して送るが、フォールバックも許容する。
const ALLOWED_AVATAR_TYPES: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};

// アバター画像の最大サイズ（5MB）。512px に圧縮済みの WebP なら十分収まる。
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

const me = new Hono<AuthVariables>()
  .use("*", requireAuth)
  .get("/profile", async (c) => {
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    const profile = await adb.getMyProfile();

    if (!profile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    return c.json(profile);
  })
  .put("/profile", zValidator("json", profileUpdateSchema), async (c) => {
    const data = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);

    const existing = await adb.getMyProfile();

    const profile = await adb.upsertMyProfile({
      username: data.username ?? c.var.clerkUserId,
      bio: data.bio ?? null,
      favoriteQuote: data.favoriteQuote ?? null,
      isPublic: data.isPublic ?? true,
      profileImageUrl: existing?.profileImageUrl ?? null,
    });

    if (data.selectedGenres !== undefined) {
      await adb.setMyGenres(data.selectedGenres);
    }

    return c.json(profile);
  })
  // プロフィール画像（アバター）をアップロードする。
  // モバイル側で 512px の WebP に圧縮した画像バイナリをそのまま body で受け取り、
  // R2 に保存したうえで users.profileImageUrl を配信用 URL に更新する。
  // Workers の R2 バインディングはネイティブに pre-signed URL を発行できないため、
  // Worker をプロキシとして R2.put() で保存する方式を採る。
  .put("/profile/avatar", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    const mimeType = contentType.split(";")[0]?.trim() ?? "";
    const ext = ALLOWED_AVATAR_TYPES[mimeType];
    if (!ext) {
      return c.json(
        { error: "対応していない画像形式です（webp/jpeg/png のみ）" },
        400,
      );
    }

    const body = await c.req.arrayBuffer();
    if (body.byteLength === 0) {
      return c.json({ error: "画像データが空です" }, 400);
    }
    if (body.byteLength > MAX_AVATAR_BYTES) {
      return c.json({ error: "画像サイズが大きすぎます（5MBまで）" }, 400);
    }

    const userId = c.var.clerkUserId;
    // ユーザーごとに固定キーにすると CDN キャッシュが残るため、毎回ユニークにする。
    const key = `avatars/${userId}/${Date.now()}.${ext}`;

    const bindings = getBindings(c);
    await bindings.AVATARS.put(key, body, {
      httpMetadata: { contentType: mimeType },
    });

    // 配信は同 Worker の GET /me/profile/avatar/:key を経由する。
    const avatarUrl = new URL(c.req.url);
    avatarUrl.pathname = `/me/profile/avatar/${key}`;
    avatarUrl.search = "";

    const db = createDb(bindings.DB);
    const adb = authorizedDb(db, userId);
    const existing = await adb.getMyProfile();
    const profile = await adb.upsertMyProfile({
      username: existing?.username ?? userId,
      bio: existing?.bio ?? null,
      favoriteQuote: existing?.favoriteQuote ?? null,
      isPublic: existing?.isPublic ?? true,
      profileImageUrl: avatarUrl.toString(),
    });

    return c.json(profile);
  });

// アバター画像を R2 から配信する。認証不要（名刺は公開前提で他者からも閲覧される）。
// キーにスラッシュを含むため `/*` でワイルドカード受けする。
const avatar = new Hono<{
  Bindings: { AVATARS: R2Bucket };
}>().get("/profile/avatar/*", async (c) => {
  // `/me/profile/avatar/` 以降をキーとして取り出す。
  const key = decodeURIComponent(
    new URL(c.req.url).pathname.replace(/^\/me\/profile\/avatar\//, ""),
  );
  if (!key.startsWith("avatars/")) {
    return c.json({ error: "Not found" }, 404);
  }

  const object = await c.env.AVATARS.get(key);
  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  // 画像はキー単位でイミュータブルなため長期キャッシュ可。
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
});

export { me, avatar };
