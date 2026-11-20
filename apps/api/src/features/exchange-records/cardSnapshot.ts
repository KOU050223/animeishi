import { publicMeishiSnapshotKey } from "../me/service";

// 交換当時の名刺コピー（issue #662）の R2 キー接頭辞。
// 公開配信される meishi-assets/ とは別のプレフィックスに置き、配信は
// 本人認証付きの GET /me/exchange-records/{recordId}/snapshot だけにする
// （自分専用の非公開コピー。他人のキーは API から一切返らない）。
export const EXCHANGE_CARD_SNAPSHOT_KEY_PREFIX = "exchange-card-snapshots/";

export function exchangeCardSnapshotKey(ownerId: string): string {
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
  avatars: R2Bucket,
  ownerId: string,
  friendId: string,
): Promise<string | null> {
  try {
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
