import type { ReactNode } from "react";
import { TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { useOpenWorkDetail } from "@/lib/workDetailContext";
import type { WorkDetailTarget } from "@/lib/workDetailContext";

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
