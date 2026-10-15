import { Hono } from "hono";
import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { profileUpdateSchema } from "./schema";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import { authorizedDb, DeletedUserError } from "@/repository/authorizedDb";
import { createDb } from "@/db/client";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import { captureApiError } from "@/observability";

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

// アバター配信パスの接頭辞。URL からの R2 キー復元・配信ハンドラで共有する。
const AVATAR_PATH_PREFIX = "/me/profile/avatar/";

// 名刺エディタの任意画像（POST /me/meishi-assets）の上限・配信パス・R2 キー接頭辞。
// アバターと同じ AVATARS バケットに meishi-assets/ プレフィックスで分けて置く
// （docs/06: 任意アップロード画像は R2 に個別アップロード）。
const MEISHI_ASSET_MAX_BYTES = 500 * 1024;
const MEISHI_ASSET_PATH_PREFIX = "/me/meishi-assets/";
const MEISHI_ASSET_KEY_PREFIX = "meishi-assets/";
// 要素削除・差し替えでオーファン化したオブジェクトも残るため、
// ストレージが無制限に増えないよう 1 ユーザーあたりの件数に緩い上限を設ける。
const MEISHI_ASSET_MAX_PER_USER = 200;

/**
 * アバター配信 URL（または同形式のパス）から R2 オブジェクトキーを復元する。
 * 不正な URL や対象外パスの場合は null を返す（旧画像の削除をスキップするため）。
 */
function avatarKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(AVATAR_PATH_PREFIX)) return null;
  try {
    const key = decodeURIComponent(pathname.slice(AVATAR_PATH_PREFIX.length));
    return key.startsWith("avatars/") ? key : null;
  } catch {
    return null;
  }
}

/** 名刺アセット配信パスから R2 オブジェクトキーを復元する。 */
function meishiAssetKeyFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith(MEISHI_ASSET_PATH_PREFIX)) return null;
  try {
    const key = decodeURIComponent(
      pathname.slice(MEISHI_ASSET_PATH_PREFIX.length),
    );
    return key.startsWith(MEISHI_ASSET_KEY_PREFIX) ? key : null;
  } catch {
    // malformed なパーセントエンコードは URIError になるため 404 扱いに倒す
    return null;
  }
}

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
  // 自分がブロックしているユーザーの一覧（ブロック解除画面用）。
  .get("/blocks", async (c) => {
    const db = createDb(getBindings(c).DB);
    const adb = authorizedDb(db, c.var.clerkUserId);
    const blocked = await adb.getMyBlocks();
    return c.json(blocked, 200);
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
    // 差し替え前に旧アバターの R2 キーを控えておく（DB 更新成功後に削除する）。
    const previousKey = avatarKeyFromUrl(existing?.profileImageUrl);

    const profile = await adb
      .upsertMyProfile({
        username: existing?.username ?? userId,
        bio: existing?.bio ?? null,
        favoriteQuote: existing?.favoriteQuote ?? null,
        isPublic: existing?.isPublic ?? true,
        profileImageUrl: avatarUrl.toString(),
      })
      .catch(async (err) => {
        // requireAuth 通過後にアカウント削除が割り込んだ場合、今回アップした
        // オブジェクトは削除済みユーザーのゴミになるため掃除しておく
        // （掃除自体の失敗はゴミが残るだけなので握り潰す）。
        if (err instanceof DeletedUserError) {
          try {
            await bindings.AVATARS.delete(key);
          } catch {
            // R2 掃除失敗は無視する
          }
        }
        throw err;
      });

    // DB 更新が成功してから旧オブジェクトを削除する。
    // 旧画像を残すと既知の URL から半永久的に取得できてしまうため。
    if (previousKey && previousKey !== key) {
      await bindings.AVATARS.delete(previousKey);
    }

    return c.json(profile);
  })
  // 名刺エディタ用の任意画像を R2 にアップロードする（issue #96 / docs/06）。
  // アバターと同じ流儀で圧縮済み画像バイナリをそのまま受け取るが、名刺の要素は
  // 複数置けるためキーを要素ごとにユニークにし、users テーブルも更新しない
  // （参照は名刺 JSON の element.uri が持つ）。削除済み要素の画像は残す
  // （オーファン GC は第2弾）。
  .post("/meishi-assets", async (c) => {
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
    if (body.byteLength > MEISHI_ASSET_MAX_BYTES) {
      return c.json({ error: "画像サイズが大きすぎます（500KBまで）" }, 400);
    }

    const userId = c.var.clerkUserId;
    const bindings = getBindings(c);

    // 件数の緩い上限。R2 list は strong consistent なので直前のアップロードも数える。
    const listed = await bindings.AVATARS.list({
      prefix: `meishi-assets/${userId}/`,
      limit: MEISHI_ASSET_MAX_PER_USER + 1,
    });
    if (listed.objects.length >= MEISHI_ASSET_MAX_PER_USER) {
      return c.json(
        {
          error: `名刺画像のアップロード上限（${MEISHI_ASSET_MAX_PER_USER}件）に達しています`,
        },
        400,
      );
    }

    // 同一ミリ秒の連続アップロードでも衝突しないようランダムな接尾辞を付ける。
    const key = `meishi-assets/${userId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;

    await bindings.AVATARS.put(key, body, {
      httpMetadata: { contentType: mimeType },
    });

    // 配信は同 Worker の GET /me/meishi-assets/* を経由する（認証不要）。
    const url = new URL(c.req.url);
    url.pathname = `${MEISHI_ASSET_PATH_PREFIX}${key}`;
    url.search = "";

    return c.json({ url: url.toString() }, 201);
  })
  // アカウント削除。App Store / Google Play の審査要件（アプリ内でアカウントを
  // 作成できる場合はアプリ内からの削除導線が必須）に対応する。
  // 削除順序は「D1 → R2 → Clerk」。Clerk を先に消すと D1 削除が失敗したときに
  // 認証手段を失った孤立データが残り、再試行もできなくなるため D1 を先に処理する。
  .delete("/", async (c) => {
    const bindings = getBindings(c);
    const userId = c.var.clerkUserId;
    const db = createDb(bindings.DB);

    // ユーザー関連テーブル（watch_history / favorites / friends / user_genres /
    // tier_lists(+items) / annict_tokens / users）を 1 batch で削除する。
    await authorizedDb(db, userId).deleteMyAccount();

    // R2 上の画像は残ると配信 URL から取得し続けられるため、本人の
    // プレフィックス（アバター avatars/{userId}/ と名刺アセット
    // meishi-assets/{userId}/）のオブジェクトを全て消す。
    // 削除自体は完了させたいので、失敗は Sentry に送るだけで握り潰す。
    // 片方のプレフィックスの掃除が失敗してももう片方は実行できるよう、
    // try/catch はプレフィックス単位にする。
    for (const prefix of [`avatars/${userId}/`, `meishi-assets/${userId}/`]) {
      try {
        let cursor: string | undefined;
        do {
          const listed = await bindings.AVATARS.list({
            prefix,
            ...(cursor ? { cursor } : {}),
          });
          if (listed.objects.length > 0) {
            await bindings.AVATARS.delete(listed.objects.map((o) => o.key));
          }
          cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
      } catch (err) {
        captureApiError(err, c);
      }
    }

    // Clerk Backend API でユーザー本体を削除する。ここで失敗した場合、D1 側は
    // 既に削除済みだが Clerk ユーザーは残るため、クライアントは再試行できる
    // （requireAuth は DELETE /me を tombstone があっても通す）。
    const clerk = c.get("clerk");
    try {
      await clerk.users.deleteUser(userId);
    } catch (err) {
      // 既に Clerk 側で削除済み（重複実行・残存 JWT による再試行）なら
      // 成功として扱い DELETE を冪等にする。
      if (!(isClerkAPIResponseError(err) && err.status === 404)) {
        throw err;
      }
    }

    return c.body(null, 204);
  });

// アバター画像を R2 から配信する。認証不要（名刺は公開前提で他者からも閲覧される）。
// キーにスラッシュを含むため `/*` でワイルドカード受けする。
const avatar = new Hono<{
  Bindings: { AVATARS: R2Bucket };
}>().get("/profile/avatar/*", async (c) => {
  // `/me/profile/avatar/` 以降をキーとして取り出す。
  const key = avatarKeyFromUrl(c.req.url);
  if (!key) {
    return c.json({ error: "Not found" }, 404);
  }

  const object = await c.env.AVATARS.get(key);
  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  return r2ImageResponse(object);
});

// R2 オブジェクトを画像レスポンスとして返す。画像はキー単位でイミュータブル
// （アップロードごとに新キー）なため長期キャッシュ可。
function r2ImageResponse(object: R2ObjectBody): Response {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

// 名刺アセット画像を R2 から配信する。アバターと同じく認証不要
// （名刺は公開前提で他者からも閲覧される）。
const meishiAssets = new Hono<{
  Bindings: { AVATARS: R2Bucket };
}>().get("/meishi-assets/*", async (c) => {
  const key = meishiAssetKeyFromUrl(c.req.url);
  if (!key) {
    return c.json({ error: "Not found" }, 404);
  }

  const object = await c.env.AVATARS.get(key);
  if (!object) {
    return c.json({ error: "Not found" }, 404);
  }

  return r2ImageResponse(object);
});

export { me, avatar, meishiAssets };
