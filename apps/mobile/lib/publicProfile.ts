import { apiUrl } from "@/lib/apiUrl";
import { ApiRequestError } from "@/lib/apiError";

export type PublicProfile = {
  id: string;
  username: string;
  bio: string | null;
  favoriteQuote: string | null;
  profileImageUrl: string | null;
  genres: string[];
};

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
