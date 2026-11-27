import { useTranslation } from "react-i18next";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import {
  AddElementSheetContent,
  type AddElementSheetProps,
} from "./AddElementSheetContent";

export function AddElementSheet({
  visible,
  onClose,
  onPick,
  onPickAvatarImage,
  onPickAnimeImage,
}: AddElementSheetProps) {
  const { t } = useTranslation();
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scrimAccessibilityLabel={t("要素の追加をやめる")}
    >
      <AddElementSheetContent
        onPick={onPick}
        onPickAvatarImage={onPickAvatarImage}
        onPickAnimeImage={onPickAnimeImage}
      />
    </BottomSheet>
  );
}
