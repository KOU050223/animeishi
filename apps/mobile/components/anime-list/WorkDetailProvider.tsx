import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { TouchableOpacity } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { AnimeWorkDetailSheet } from "./AnimeWorkDetailSheet";
import type { WorkDetailSheetTarget } from "./AnimeWorkDetailSheet";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";
import { alert } from "@/lib/dialog";

export type WorkDetailTarget = Pick<
  WorkDetailSheetTarget,
  "annictWorkId" | "title"
> &
  Partial<Omit<WorkDetailSheetTarget, "annictWorkId" | "title">>;

const WorkDetailContext = createContext<(work: WorkDetailTarget) => void>(
  () => {},
);

export function useOpenWorkDetail() {
  return useContext(WorkDetailContext);
}

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

export function WorkDetailPressable({
  work,
  children,
  testID,
  className,
}: {
  work: WorkDetailTarget;
  children: ReactNode;
  testID?: string;
  className?: string;
}) {
  const openWork = useOpenWorkDetail();
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      className={className}
      onPress={() => openWork(work)}
      accessibilityRole="button"
      accessibilityLabel={t("{{title}} の詳細を開く", { title: work.title })}
      testID={testID}
    >
      {children}
    </TouchableOpacity>
  );
}
