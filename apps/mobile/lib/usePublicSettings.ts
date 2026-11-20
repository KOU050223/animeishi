import { useState } from "react";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { useProfile, useUpdateProfile } from "@/lib/useProfile";
import { useWorkLists, useSaveWorkList } from "@/lib/workList/useWorkLists";
import { useMergedTierLists } from "@/lib/tierList/useMergedTierLists";
import { useSaveTierList } from "@/lib/tierList/useTierList";
import { useSaveCharacterTierList } from "@/lib/tierList/useCharacterTierList";
import { useSaveCustomTierList } from "@/lib/tierList/useCustomTierList";
import { parseTiersJson } from "@/lib/tierList/board";
import type {
  PublicSettingItem,
  PublicSettingKind,
} from "@/components/profile/PublicSettingsSection";

export function usePublicSettings() {
  const { getToken } = useAuth();
  const profile = useProfile();
  const workLists = useWorkLists();
  const tierLists = useMergedTierLists();
  const updateProfile = useUpdateProfile();
  const saveWork = useSaveWorkList();
  const saveSeason = useSaveTierList();
  const saveCharacter = useSaveCharacterTierList();
  const saveCustom = useSaveCustomTierList();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const items: PublicSettingItem[] = [
    ...(workLists.data ?? []).map((item) => ({
      key: `work-${item.id}`,
      kind: "work" as const,
      id: String(item.id),
      title: item.title,
      isPublic: item.isPublic,
    })),
    ...tierLists.items.map(({ key, kind, id, title, isPublic }) => ({
      key,
      kind,
      id,
      title,
      isPublic,
    })),
  ];

  async function toggle(
    kind: PublicSettingKind,
    id: string,
    isPublic: boolean,
  ) {
    if (pendingKey) return;
    setPendingKey(`${kind}-${id}`);
    try {
      if (kind === "profile") {
        await updateProfile.mutateAsync({ isPublic });
        return;
      }
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      const headers = { Authorization: `Bearer ${token}` };
      if (kind === "work") {
        const response = await apiClient.me["work-lists"][":id"].$get(
          { param: { id } },
          { headers },
        );
        if (!response.ok) throw new Error("作品リストの取得に失敗しました");
        const detail = await response.json();
        await saveWork.mutateAsync({
          id: Number(id),
          title: detail.title,
          description: detail.description,
          isPublic,
          items: detail.items.map(({ annictWorkId }) => ({ annictWorkId })),
        });
      } else if (kind === "season") {
        const response = await apiClient.me["tier-lists"][":season"].$get(
          { param: { season: id } },
          { headers },
        );
        if (!response.ok) throw new Error("Tier 表の取得に失敗しました");
        const detail = await response.json();
        const tiers = parseTiersJson(detail.tiersJson);
        if (!tiers) throw new Error("Tier 表の取得に失敗しました");
        await saveSeason.mutateAsync({
          season: id,
          title: detail.title,
          description: detail.description,
          isPublic,
          tiers,
          items: detail.items.map(({ annictWorkId, tierKey }) => ({
            annictWorkId,
            tierKey,
          })),
        });
      } else if (kind === "character") {
        const response = await apiClient.me["character-tier-lists"][
          ":annictWorkId"
        ].$get({ param: { annictWorkId: id } }, { headers });
        if (!response.ok) throw new Error("Tier 表の取得に失敗しました");
        const detail = await response.json();
        const tiers = parseTiersJson(detail.tiersJson);
        if (!tiers) throw new Error("Tier 表の取得に失敗しました");
        await saveCharacter.mutateAsync({
          annictWorkId: Number(id),
          title: detail.title,
          description: detail.description,
          isPublic,
          tiers,
          items: detail.items.map(({ annictCharacterId, tierKey }) => ({
            annictCharacterId,
            tierKey,
          })),
        });
      } else {
        const response = await apiClient.me["custom-tier-lists"][":id"].$get(
          { param: { id } },
          { headers },
        );
        if (!response.ok) throw new Error("Tier 表の取得に失敗しました");
        const detail = await response.json();
        const tiers = parseTiersJson(detail.tiersJson);
        if (!tiers) throw new Error("Tier 表の取得に失敗しました");
        await saveCustom.mutateAsync({
          id: Number(id),
          title: detail.title,
          description: detail.description,
          isPublic,
          tiers,
          items: detail.items.map(({ annictWorkId, tierKey }) => ({
            annictWorkId,
            tierKey,
          })),
        });
      }
    } finally {
      setPendingKey(null);
    }
  }

  return {
    profilePublic: profile.data?.isPublic ?? false,
    items,
    isLoading: workLists.isLoading || tierLists.isLoading,
    isError: workLists.isError || tierLists.isError,
    pendingKey,
    toggle,
  };
}
