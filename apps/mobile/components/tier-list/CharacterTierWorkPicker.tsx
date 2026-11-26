import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { initialWindowMetrics } from "react-native-safe-area-context";
import { WorkAddSheet } from "@/components/tier-list/WorkAddSheet";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { useWorkCatalogAccess } from "@/features/annict";
import { useThemeColors } from "@/lib/theme";
import type { TierItem } from "@/features/tier-lists/types";

// ピッカーでは「既に追加済み」の概念が無いため、重複表示は常に空集合にする。
const NO_EXISTING = new Set<number>();

/**
 * キャラクター Tier 表の対象作品を選ぶ検索シート（issue #352）。
 *
 * WorkAddSheet（未分類トレイへの作品追加用）を「追加」ではなく「選択」
 * として使い、選んだ作品を onSelect で返す。選択後は呼び出し側で
 * シートを閉じて編集画面へ遷移する。
 * 作品検索は本人の Annict トークンか共用トークンが要る（issue #561）。
 * どちらも無いときは検索 UI の代わりに連携誘導（compact）を出す
 * （空の検索欄を見せても選べない）。
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
  const { t } = useTranslation();
  const colors = useThemeColors();
  const { canBrowseWorks, isLoading } = useWorkCatalogAccess();

  if (canBrowseWorks) {
    return (
      <WorkAddSheet
        visible={visible}
        onClose={onClose}
        onAdd={onSelect}
        existingWorkIds={NO_EXISTING}
        heading={t("作品を選ぶ")}
        description={t(
          "キャラクター Tier 表を作る作品のタイトルを検索してください",
        )}
        actionLabel={t("選ぶ")}
        scrimAccessibilityLabel={t("作品の選択をやめる")}
      />
    );
  }

  // 作品情報を使えない・確認中のシート。WorkAddSheet と同じボトムシートの外枠に
  // 連携誘導を載せる。
  return (
    <Modal
      transparent
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          justifyContent: "flex-end",
          alignItems: "center",
        }}
      >
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t("作品の選択をやめる")}
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]}
        />
        <Pressable
          onPress={() => {}}
          accessibilityRole="none"
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            padding: 16,
            // Modal は全画面を覆うため下端はホームインジケータまで届く。
            // 固定 32 ではホームインジケータ領域に掛かるので inset を足す
            // （issue #462。タブバーではなくウィンドウの inset を使う）。
            paddingBottom: 32 + (initialWindowMetrics?.insets.bottom ?? 0),
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
            accessibilityLabel={t("閉じる")}
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
              {t("閉じる")}
            </Text>
          </Pressable>
        </Pressable>
      </View>
    </Modal>
  );
}
