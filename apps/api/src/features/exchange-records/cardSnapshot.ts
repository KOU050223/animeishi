import type { DrizzleDb } from "#src/db/client";
import { publicMeishiSnapshotKey } from "../me/service";
import { findUserById } from "../users/repository";

// 交換当時の名刺コピー（issue #662）の R2 キー接頭辞。
// 公開配信される meishi-assets/ とは別のプレフィックスに置き、配信は
// 本人認証付きの GET /me/exchange-records/{recordId}/snapshot だけにする
// （自分専用の非公開コピー。他人のキーは API から一切返らない）。
export const EXCHANGE_CARD_SNAPSHOT_KEY_PREFIX = "exchange-card-snapshots/";

function exchangeCardSnapshotKey(ownerId: string): string {
  return `${EXCHANGE_CARD_SNAPSHOT_KEY_PREFIX}${ownerId}/${crypto.randomUUID()}.png`;
}

/**
 * friendId が公開している現行の名刺スナップショット（issue #593 の
 * meishi-assets/<userId>/public-snapshot.png）を、ownerId 専用の
 * 非公開コピーとして R2 に複製する。
 * 相手がスナップショットを公開していなければ null を返す。
 * R2 へのアクセス自体が失敗した場合も例外を外に出さない（コピーは
 * 履歴の付加要素であり、交換記録の作成自体を止めない）。
 */
export async function copyPublicCardSnapshot(
  db: DrizzleDb,
  avatars: R2Bucket,
  ownerId: string,
  friendId: string,
): Promise<string | null> {
  try {
    // 公開配信の meishi-assets エンドポイントと同じく、相手が非公開に
    // 切り替えていれば残存する公開スナップショットはコピーしない
    // （非公開の名刺をフレンド専用コピーへ持ち込まない）。
    const sourceUser = await findUserById(db, friendId);
    if (!sourceUser?.isPublic) return null;
    const source = await avatars.get(publicMeishiSnapshotKey(friendId));
    if (!source) return null;
    const key = exchangeCardSnapshotKey(ownerId);
    await avatars.put(key, await source.arrayBuffer(), {
      httpMetadata: { contentType: "image/png" },
    });
    return key;
  } catch (error) {
    console.error("交換当時の名刺コピーの保存に失敗しました", error);
    return null;
  }
}
