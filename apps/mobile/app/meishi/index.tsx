import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import { MeishiCard } from "@/components/MeishiCard";
import { BackButton } from "@/components/ui";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { confirm } from "@/lib/dialog";
import { buildProfileUrl } from "@/lib/profileUrl";
import { MEISHI_ASPECT_RATIO } from "@/lib/meishi/defaults";
import { useMeishiLibrary } from "@/lib/meishi/useMeishiLibrary";
import type { MeishiCardData } from "@/lib/meishi/types";
import { useProfile } from "@/lib/useProfile";
import { useThemeColors } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";

/**
 * 名刺のデッキ一覧（issue #427）。複数の名刺を並べて表示し、
 * 作成・複製・削除・既定の切り替え・全画面表示への遷移を行う。
 */
export default function MeishiDeckScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { data: profile } = useProfile();
  const {
    cards,
    defaultCard,
    loaded,
    duplicateCard,
    removeCard,
    setDefault,
    reload,
  } = useMeishiLibrary();
  const [menuCard, setMenuCard] = useState<MeishiCardData | null>(null);

  // エディタや全画面表示から戻ってきたときに最新の内容を反映する
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/(tabs)/profile");
  };

  const openCard = (card: MeishiCardData) =>
    router.push({ pathname: "/meishi/[id]", params: { id: card.id } });
  const editCard = (card: MeishiCardData) =>
    router.push({ pathname: "/meishi/edit", params: { id: card.id } });
  const createCard = () =>
    router.push({ pathname: "/meishi/edit", params: { create: "1" } });

  const confirmDelete = (card: MeishiCardData) =>
    confirm(
      t("名刺を削除"),
      t("削除した名刺は元に戻せません"),
      () => void removeCard(card.id),
      {
        confirmLabel: t("削除する"),
        cancelLabel: t("キャンセル"),
        destructive: true,
      },
    );

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.background }}
      edges={["top", "bottom", "left", "right"]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <BackButton onPress={handleBack} accessibilityLabel={t("戻る")} />
        <Text style={styles.headerTitle}>{t("名刺一覧")}</Text>
        <View style={styles.headerSpacer} />
      </View>

      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : cards.length === 0 ? (
        <View style={[styles.center, { padding: 24 }]}>
          <Text style={styles.emptyText}>{t("まだ名刺がありません")}</Text>
          <Pressable
            onPress={createCard}
            style={styles.createButton}
            accessibilityRole="button"
            accessibilityLabel={t("新しい名刺を作る")}
          >
            <Text style={styles.createButtonText}>{t("新しい名刺を作る")}</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {cards.map((card) => (
            <View key={card.id} style={styles.cell}>
              <Pressable
                onPress={() => openCard(card)}
                accessibilityRole="button"
                accessibilityLabel={t("{{name}}を開く", { name: card.name })}
              >
                <MeishiCard
                  username={profile?.username}
                  bio={profile?.bio}
                  favoriteQuote={profile?.favoriteQuote}
                  profileImageUrl={profile?.profileImageUrl}
                  profileUrl={buildProfileUrl(profile?.id)}
                  document={card.document}
                />
              </Pressable>
              <View style={styles.cellFooter}>
                <View style={styles.nameRow}>
                  <Text style={styles.cardName} numberOfLines={1}>
                    {card.name}
                  </Text>
                  {card.id === defaultCard?.id ? (
                    <View style={styles.defaultBadge}>
                      <Text style={styles.defaultBadgeText}>{t("既定")}</Text>
                    </View>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => setMenuCard(card)}
                  style={styles.menuButton}
                  accessibilityRole="button"
                  accessibilityLabel={t("{{name}}のメニュー", {
                    name: card.name,
                  })}
                  hitSlop={8}
                >
                  <Ionicons
                    name="ellipsis-horizontal"
                    size={18}
                    color={colors.textMuted}
                  />
                </Pressable>
              </View>
            </View>
          ))}
          <View style={styles.cell}>
            <Pressable
              onPress={createCard}
              style={styles.newCardTile}
              accessibilityRole="button"
              accessibilityLabel={t("新しい名刺を作る")}
            >
              <Ionicons name="add" size={28} color={colors.textMuted} />
              <Text style={styles.newCardText}>{t("新しい名刺")}</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}

      <BottomSheet
        visible={menuCard !== null}
        onClose={() => setMenuCard(null)}
        scrimAccessibilityLabel={t("メニューを閉じる")}
      >
        {menuCard ? (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetTitle}>{menuCard.name}</Text>
            <SheetItem
              label={t("全画面で見る")}
              onPress={() => {
                const card = menuCard;
                setMenuCard(null);
                openCard(card);
              }}
              styles={styles}
            />
            <SheetItem
              label={t("編集する")}
              onPress={() => {
                const card = menuCard;
                setMenuCard(null);
                editCard(card);
              }}
              styles={styles}
            />
            <SheetItem
              label={t("複製する")}
              onPress={() => {
                const card = menuCard;
                setMenuCard(null);
                void duplicateCard(card.id);
              }}
              styles={styles}
            />
            {menuCard.id !== defaultCard?.id ? (
              <SheetItem
                label={t("既定にする")}
                onPress={() => {
                  const card = menuCard;
                  setMenuCard(null);
                  void setDefault(card.id);
                }}
                styles={styles}
              />
            ) : null}
            <SheetItem
              label={t("削除する")}
              destructive
              onPress={() => {
                const card = menuCard;
                setMenuCard(null);
                confirmDelete(card);
              }}
              styles={styles}
            />
          </View>
        ) : null}
      </BottomSheet>
    </SafeAreaView>
  );
}

function SheetItem({
  label,
  onPress,
  destructive,
  styles,
}: {
  label: string;
  onPress: () => void;
  destructive?: boolean;
  styles: DeckStyles;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={styles.sheetItem}
      accessibilityRole="button"
    >
      <Text
        style={[styles.sheetItemText, destructive && styles.sheetItemDanger]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

type DeckStyles = ReturnType<typeof createStyles>;

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
    // BackButton と同じ幅のスペーサーでタイトルを中央に置く
    headerSpacer: { width: 40 },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap",
      padding: 8,
    },
    cell: {
      width: "50%",
      padding: 8,
    },
    cellFooter: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginTop: 6,
    },
    nameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexShrink: 1,
    },
    cardName: { fontSize: 13, fontWeight: "600", color: colors.text },
    defaultBadge: {
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: colors.primary,
    },
    defaultBadgeText: {
      fontSize: 10,
      fontWeight: "700",
      color: colors.onPrimary,
    },
    menuButton: { padding: 4 },
    newCardTile: {
      aspectRatio: MEISHI_ASPECT_RATIO,
      borderRadius: 16,
      borderWidth: 1.5,
      borderStyle: "dashed",
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
    },
    newCardText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
    emptyText: {
      fontSize: 14,
      color: colors.textMuted,
      marginBottom: 16,
    },
    createButton: {
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.primary,
    },
    createButtonText: {
      color: colors.onPrimary,
      fontWeight: "600",
      fontSize: 15,
    },
    sheetBody: { paddingBottom: 8 },
    sheetTitle: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textMuted,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    sheetItem: {
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    sheetItemText: { fontSize: 16, color: colors.text },
    sheetItemDanger: { color: colors.danger },
  });
}
