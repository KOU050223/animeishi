import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { WorkAddSheet } from "@/components/tier-list/WorkAddSheet";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { useAnnictConnection } from "@/lib/annict";
import { useThemeColors } from "@/lib/theme";
import type { TierItem } from "@/lib/tierList/types";

// ピッカーでは「既に追加済み」の概念が無いため、重複表示は常に空集合にする。
const NO_EXISTING = new Set<number>();

/**
 * キャラクター Tier 表の対象作品を選ぶ検索シート（issue #352）。
 *
 * WorkAddSheet（未分類トレイへの作品追加用）を「追加」ではなく「選択」
 * として使い、選んだ作品を onSelect で返す。選択後は呼び出し側で
 * シートを閉じて編集画面へ遷移する。
 * 作品検索は Annict トークン必須のため、未連携では検索 UI の代わりに
 * 連携誘導（compact）を出す（空の検索欄を見せても選べない）。
 */
export function CharacterTierWorkPicker({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  /** 検索結果の作品が選ばれたとき。 */
  onSelect: (work: TierItem) => void;
}) {
  const colors = useThemeColors();
  const { isConnected, isLoading } = useAnnictConnection();

  if (isConnected) {
    return (
      <WorkAddSheet
        visible={visible}
        onClose={onClose}
        onAdd={onSelect}
        existingWorkIds={NO_EXISTING}
        heading="作品を選ぶ"
        description="キャラクター Tier 表を作る作品のタイトルを検索してください"
        actionLabel="選ぶ"
      />
    );
  }

  // 未連携・接続確認中のシート。WorkAddSheet と同じボトムシートの外枠に
  // 連携誘導を載せる。
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          backgroundColor: colors.scrim,
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={() => {}}
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            padding: 16,
            paddingBottom: 32,
            width: "100%",
            maxWidth: 560,
          }}
        >
          {isLoading ? (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <ActivityIndicator color={colors.textMuted} />
            </View>
          ) : (
            <AnnictSoftGate
              variant="compact"
              description="キャラクター Tier 表の作成には Annict との連携が必要です。連携すると作品のキャラクターを並べ替えられます。"
              surface="character_tier_list"
            />
          )}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="閉じる"
            testID="character-tier-picker-close"
            style={{
              marginTop: 12,
              paddingVertical: 12,
              borderRadius: 8,
              backgroundColor: colors.surfaceMuted,
              alignItems: "center",
            }}
          >
            <Text style={{ fontWeight: "600", color: colors.text }}>
              閉じる
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
