import type { ReactNode } from "react";
import { TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";
import { useOpenWorkDetail } from "@/features/works/workDetailContext";
import type { WorkDetailTarget } from "@/features/works/workDetailContext";

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
      // nativewind の className は省略可能プロパティなので、未指定時は
      // キーごと渡さない（exactOptionalPropertyTypes 対応）。
      {...(className !== undefined ? { className } : {})}
      onPress={() => openWork(work)}
      accessibilityRole="button"
      accessibilityLabel={t("{{title}} の詳細を開く", { title: work.title })}
      testID={testID}
    >
      {children}
    </TouchableOpacity>
  );
}
