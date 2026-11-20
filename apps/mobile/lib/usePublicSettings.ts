import { useState } from "react";
import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { PROFILE_QUERY_KEY, useProfile } from "@/lib/useProfile";
import type { PublicSettingVisibility } from "@/components/profile/PublicSettingsSection";

// プロフィール画面の「公開設定」セクション（issue #604）の現在値と
// 切り替えの保存。一覧に行を足すときは key ごとの保存先をここに分岐させる。
export function usePublicSettings() {
  const { getToken } = useAuth();
  const profile = useProfile();
  const queryClient = useQueryClient();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // 「プロフィールと名刺」行は users.is_public の 2 段階（公開／非公開）。
  // 未取得時は API 側の既定（公開）に合わせる。
  const profileVisibility: PublicSettingVisibility =
    profile.data?.isPublic === false ? "private" : "public";

  async function toggle(key: string, visibility: PublicSettingVisibility) {
    if (pendingKey) return;
    setPendingKey(key);
    try {
      if (key === "profile") {
        // is_public だけを更新する専用エンドポイント。PUT /me/profile は
        // 未送信の項目を消すため、公開範囲の切り替えには使えない。
        const token = await getToken();
        if (!token) throw new Error("認証トークンが取得できませんでした");
        const res = await apiClient.me.profile.visibility.$put(
          { json: { isPublic: visibility === "public" } },
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          throw new ApiRequestError(res.status, "公開設定の更新に失敗しました");
        }
        await queryClient.invalidateQueries({
          queryKey: PROFILE_QUERY_KEY,
        });
      } else {
        throw new Error(`未知の公開設定キーです: ${key}`);
      }
    } finally {
      setPendingKey(null);
    }
  }

  return { profileVisibility, pendingKey, toggle };
}
