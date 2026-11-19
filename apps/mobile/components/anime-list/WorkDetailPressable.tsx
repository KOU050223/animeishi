import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import type { WorkDetailSheetTarget } from "./AnimeWorkDetailSheet";

export type WorkDetailTarget = Pick<
  WorkDetailSheetTarget,
  "annictWorkId" | "title"
> &
  Partial<Omit<WorkDetailSheetTarget, "annictWorkId" | "title">>;

export const WorkDetailContext = createContext<
  (work: WorkDetailTarget) => void
>(() => {});

export function useOpenWorkDetail() {
  return useContext(WorkDetailContext);
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
