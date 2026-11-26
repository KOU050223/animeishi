import { apiUrl } from "@/lib/apiUrl";
import { ApiRequestError } from "@/lib/apiError";
import type { SocialLink } from "@/features/social-links/socialLinks";

// 「いま見ている」吹き出し（issue #420）に載せる直近の話数記録 1 件。
// 直近 24 時間に記録が無ければ null。GET /me/profile の nowWatching と同形。
export type NowWatching = {
  annictWorkId: number;
  annictEpisodeId: number;
  title: string;
  titleEn: string | null;
  seasonName: string | null;
  seasonYear: number | null;
  hostedImageUrl: string | null;
  recordedAt: string;
};

export type PublicProfile = {
  id: string;
  username: string;
  bio: string | null;
  favoriteQuote: string | null;
  profileImageUrl: string | null;
  // 既定の名刺の公開スナップショット（issue #593）。未作成なら null。
  // ?v= に版が入るため、再生成されると URL ごと変わる。
  meishiSnapshotUrl: string | null;
  genres: string[];
  nowWatching: NowWatching | null;
  socialLinks: SocialLink[];
};

// 公開プロフィールのクエリキー。app/user/[uid].tsx の useQuery・
// 交換成立オーバーレイ（ExchangeSuccessOverlay）・本人の話数記録変更時の
// 無効化（useWorkEpisodes）で共有する。
// レスポンスの SNS リンク欄は閲覧者との関係で変わる（issue #658）ため
// キーを閲覧者で分ける。分けないとフレンド向けに見えたリンクが
// アカウント切り替え後のキャッシュから他人に漏れる。
// 無効化するときは閲覧者を含まない uid までの prefix で行う。
export const PUBLIC_PROFILE_QUERY_KEY = ["public-profile"] as const;
export const publicProfileQueryKey = (uid: string, viewerId?: string | null) =>
  [...PUBLIC_PROFILE_QUERY_KEY, uid, viewerId ?? "guest"] as const;

/**
 * 公開プロフィール（GET /user/:uid）の取得。
 * app/user/[uid].tsx の公開ページと名刺交換成立の演出で同じデータを使う。
 */
export async function fetchPublicProfile(
  uid: string,
  token: string | null,
): Promise<PublicProfile> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(`${apiUrl}/user/${uid}`, {
      headers: {
        Accept: "application/json",
        // ブロック関係にある相手の名刺を隠すため、サインイン済みなら
        // 閲覧者をサーバーに伝える（公開URLでもブロックを効かせる）。
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  if (res.status === 404) throw new ApiRequestError(404, "not_found");
  if (!res.ok) throw new ApiRequestError(res.status, "fetch_error");
  return res.json() as Promise<PublicProfile>;
}
