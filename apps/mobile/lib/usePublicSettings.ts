import { useState } from "react";
import { useProfile, useUpdateProfile } from "@/lib/useProfile";
import type { PublicSettingVisibility } from "@/components/profile/PublicSettingsSection";

// プロフィール画面の「公開設定」セクション（issue #604）の現在値と
// 切り替えの保存。一覧に行を足すときは key ごとの保存先をここに分岐させる。
export function usePublicSettings() {
  const profile = useProfile();
  const updateProfile = useUpdateProfile();
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
        const current = profile.data;
        if (!current) throw new Error("プロフィールが未取得です");
        // PUT /me/profile は未送信の項目を消す（bio / favoriteQuote は
        // null、username は Clerk ID に戻る）ため、公開範囲の切り替えでも
        // 取得済みの値を全部送る。
        await updateProfile.mutateAsync({
          username: current.username,
          bio: current.bio ?? undefined,
          favoriteQuote: current.favoriteQuote ?? undefined,
          isPublic: visibility === "public",
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
