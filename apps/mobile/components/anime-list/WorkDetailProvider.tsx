import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AnimeWorkDetailSheet } from "./AnimeWorkDetailSheet";
import type { WorkDetailSheetTarget } from "./AnimeWorkDetailSheet";
import { WorkDetailContext } from "./WorkDetailPressable";
import type { WorkDetailTarget } from "./WorkDetailPressable";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";
import { alert } from "@/lib/dialog";

export function WorkDetailProvider({ children }: { children: ReactNode }) {
  const [work, setWork] = useState<WorkDetailSheetTarget | null>(null);
  const favoriteIds = useFavoriteIds();
  const router = useRouter();
  const { t } = useTranslation();
  const { toggle, isPending } = useToggleFavorite(favoriteIds, {
    onError: () =>
      alert(t("更新できませんでした"), t("時間をおいて再度お試しください。"), {
        okLabel: t("OK"),
      }),
  });
  const openWork = useCallback((target: WorkDetailTarget) => {
    setWork({
      annictWorkId: target.annictWorkId,
      title: target.title,
      titleEn: target.titleEn ?? null,
      seasonYear: target.seasonYear ?? null,
      seasonName: target.seasonName ?? null,
      hostedImageUrl: target.hostedImageUrl ?? null,
    });
  }, []);

  return (
    <WorkDetailContext.Provider value={openWork}>
      {children}
      <AnimeWorkDetailSheet
        work={work}
        onClose={() => setWork(null)}
        isFavorite={work != null && favoriteIds.has(work.annictWorkId)}
        isTogglingFavorite={isPending}
        onToggleFavorite={() => {
          if (work) toggle(work.annictWorkId);
        }}
        onOpenCharacterTierList={(target) =>
          router.push({
            pathname: "/character-tier-list",
            params: {
              workId: String(target.annictWorkId),
              workTitle: target.title,
            },
          })
        }
      />
    </WorkDetailContext.Provider>
  );
}
