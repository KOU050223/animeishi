import type { Context } from "hono";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  friendsRepository,
  FriendNotFoundError,
  FRIEND_UPDATES_LIMIT,
} from "./repository";
import { listCardSnapshotKeysBetween } from "../exchange-records/repository";
import {
  issueOfflineExchangeToken,
  issueQrExchangeToken,
  OFFLINE_EXCHANGE_TOKEN_TTL_SEC,
  verifyOfflineExchangeToken,
  verifyQrExchangeToken,
} from "./qrExchangeToken";
import { UserBlockedError } from "../users/repository";
import {
  publicMeishiSnapshotKey,
  publicMeishiSnapshotUrl,
} from "../me/service";
import {
  addFriendRoute,
  getFriendNoteRoute,
  getFriendUpdatesRoute,
  getFriendsRoute,
  getQrTokenRoute,
  putFriendNoteRoute,
  removeFriendRoute,
} from "./schema";
import type { FriendUpdateType } from "./schema";
import { createDb } from "@/db/client";
import { workImageUrl } from "@/lib/annict/workImage";
import { createOpenApiApp } from "@/lib/openapi";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database; AVATARS: R2Bucket } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & {
    DB: D1Database;
    AVATARS: R2Bucket;
  };
}

const app = createOpenApiApp<AuthVariables>();
app.use("*", requireAuth);
const friends = app
  .openapi(getFriendsRoute, async (c) => {
    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(db, c.var.clerkUserId);
    const data = await repo.getMyFriends();
    // 名刺帳（issue #659）で名刺そのものを並べるため、相手ごとの公開
    // スナップショット（issue #593）の有無を R2 で確認して配信 URL を付ける。
    // 公開名刺一覧（features/users/public.ts）と同じ方式。
    const items = await Promise.all(
      data.map(async (item) => {
        const snapshot = await getBindings(c).AVATARS.head(
          publicMeishiSnapshotKey(item.friendId),
        );
        return {
          ...item,
          meishiSnapshotUrl: snapshot
            ? publicMeishiSnapshotUrl(
                c.req.url,
                item.friendId,
                snapshot.customMetadata?.version ??
                  snapshot.uploaded.toISOString(),
              )
            : null,
        };
      }),
    );
    return c.json(items, 200);
  })
  .openapi(getQrTokenRoute, async (c) => {
    // 対面交換 QR に埋め込む短期トークンを発行する（issue #417）。
    // トークンは認証ユーザー自身に紐づくため、他人のトークンは取れない。
    // あわせてオフライン交換用の長寿命トークン（ot）も返す。表示側が
    // オフラインでこのエンドポイントを呼べない状況に備え、クライアントは
    // ot を端末に保持しておく（issue #663）。
    const secret = getBindings(c).CLERK_SECRET_KEY;
    const { token, expiresAt } = await issueQrExchangeToken(
      secret,
      c.var.clerkUserId,
    );
    const offline = await issueOfflineExchangeToken(secret, c.var.clerkUserId);
    return c.json(
      {
        token,
        expiresAt,
        offlineToken: offline.token,
        offlineExpiresAt: offline.expiresAt,
      },
      200,
    );
  })
  .openapi(addFriendRoute, async (c) => {
    const { friendId, qrToken, offlineToken, scannedAt } = c.req.valid("json");
    if (friendId === c.var.clerkUserId) {
      return c.json({ error: "自分自身をフレンドに追加できません" }, 400);
    }
    // 即時成立は対面 QR 交換に限る。トークンが無い・無効・期限切れの場合は
    // 申請フロー（/me/friend-requests）を使うよう code で知らせる（issue #417）。
    // offlineToken はオフライン交換用の長寿命トークン（issue #663）で、
    // qt とは別の用途名で署名されるため相互流用は検証で弾かれる。
    const secret = getBindings(c).CLERK_SECRET_KEY;
    const tokenOk =
      (await verifyQrExchangeToken(secret, friendId, qrToken)) ||
      (await verifyOfflineExchangeToken(secret, friendId, offlineToken));
    if (!tokenOk) {
      return c.json(
        {
          error:
            "対面 QR の有効期限が切れています。フレンド申請を送ってください",
          code: "qr_exchange_required",
        },
        403,
      );
    }

    // scannedAt（issue #681 の交換キュー送信）は交換記録の「実際に会った
    // 日時」に使う。クライアント時計は信用できないため、未来の値や ot の
    // 有効期限（24h）より古い値は採用せず現在時刻に倒す。成立可否の
    // 判断には使わない。
    const nowMs = Date.now();
    const scannedMs = scannedAt ? Date.parse(scannedAt) : NaN;
    const metAt =
      Number.isFinite(scannedMs) &&
      scannedMs <= nowMs &&
      nowMs - scannedMs <= OFFLINE_EXCHANGE_TOKEN_TTL_SEC * 1000
        ? new Date(scannedMs)
        : undefined;

    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(
      db,
      c.var.clerkUserId,
      getBindings(c).AVATARS,
    );

    try {
      const result = await repo.addFriend(friendId, metAt);
      return c.json(result, 201);
    } catch (e) {
      if (e instanceof FriendNotFoundError) {
        return c.json({ error: "User not found" }, 404);
      }
      if (e instanceof UserBlockedError) {
        return c.json({ error: "このユーザーは追加できません" }, 403);
      }
      throw e;
    }
  })
  .openapi(getFriendNoteRoute, async (c) => {
    const { friendId } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(db, c.var.clerkUserId);
    try {
      const note = await repo.getFriendNote(friendId);
      return c.json(
        {
          body: note?.body ?? null,
          updatedAt: note?.updatedAt.toISOString() ?? null,
        },
        200,
      );
    } catch (e) {
      if (e instanceof FriendNotFoundError) {
        return c.json({ error: "フレンドではありません" }, 404);
      }
      throw e;
    }
  })
  .openapi(putFriendNoteRoute, async (c) => {
    const { friendId } = c.req.valid("param");
    const { body } = c.req.valid("json");
    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(db, c.var.clerkUserId);
    try {
      const note = await repo.putFriendNote(friendId, body);
      return c.json(
        {
          body: note?.body ?? null,
          updatedAt: note?.updatedAt.toISOString() ?? null,
        },
        200,
      );
    } catch (e) {
      if (e instanceof FriendNotFoundError) {
        return c.json({ error: "フレンドではありません" }, 404);
      }
      throw e;
    }
  })
  // 名刺帳の相手の近況（issue #660）。フレンドでなければ 404、相手が
  // 非公開なら空を返す。名刺デザインの更新は活動として記録せず、
  // 公開スナップショット（R2）の撮り直し時刻からここで合成する
  // （別データを二重管理しない / 既存 feed に新種類を載せないため）。
  .openapi(getFriendUpdatesRoute, async (c) => {
    const { friendId } = c.req.valid("param");
    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(db, c.var.clerkUserId);

    type UpdateItem = {
      id: number | null;
      type: FriendUpdateType;
      createdAt: string;
      work: {
        annictWorkId: number;
        title: string;
        titleEn: string | null;
        hostedImageUrl: string | null;
      } | null;
      meta: Record<string, unknown> | null;
    };

    try {
      const { friendIsPublic, items } = await repo.getFriendUpdates(friendId);
      const updates: UpdateItem[] = items.map((row) => ({
        id: row.id,
        type: row.type,
        createdAt: row.createdAt.toISOString(),
        work: row.work
          ? {
              ...row.work,
              hostedImageUrl: workImageUrl(c.req.url, row.work.annictWorkId),
            }
          : null,
        meta: row.meta
          ? (JSON.parse(row.meta) as Record<string, unknown>)
          : null,
      }));

      if (friendIsPublic) {
        const snapshot = await getBindings(c).AVATARS.head(
          publicMeishiSnapshotKey(friendId),
        );
        if (snapshot) {
          updates.push({
            id: null,
            type: "meishi_updated",
            createdAt: snapshot.uploaded.toISOString(),
            work: null,
            meta: null,
          });
        }
        updates.sort(
          (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
        );
        updates.splice(FRIEND_UPDATES_LIMIT);
      }
      return c.json({ items: updates }, 200);
    } catch (e) {
      if (e instanceof FriendNotFoundError) {
        return c.json({ error: "フレンドではありません" }, 404);
      }
      throw e;
    }
  })
  .openapi(removeFriendRoute, async (c) => {
    const { friendId } = c.req.valid("param");

    const db = createDb(getBindings(c).DB);
    const repo = friendsRepository(db, c.var.clerkUserId);
    // 解除で消える交換記録に紐付く名刺コピー（issue #662）も R2 から消す。
    // コピーは本人専用で URL が他者に漏れていても本人認証でしか配信
    // されないが、記録が消えた以上オブジェクトも残さない。
    // R2 を先に消すのは、削除が失敗したとき D1 の記録が残っていれば
    // 再試行で同じキーを消せるようにするため（逆順だと行は消えて
    // コピーだけが残る）。
    const snapshotKeys = await listCardSnapshotKeysBetween(
      db,
      c.var.clerkUserId,
      friendId,
    );
    if (snapshotKeys.length > 0) {
      await getBindings(c).AVATARS.delete(snapshotKeys);
    }
    await repo.removeFriend(friendId);
    return c.json({ success: true }, 200);
  });

export { friends };
