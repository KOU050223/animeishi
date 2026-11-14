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
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scrimAccessibilityLabel="要素の追加をやめる"
    >
      <AddElementSheetContent
        onPick={onPick}
        onPickAvatarImage={onPickAvatarImage}
        onPickAnimeImage={onPickAnimeImage}
      />
    </BottomSheet>
  );
}
