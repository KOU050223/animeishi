import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import {
  Stack,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { MeishiCard } from "@/components/MeishiCard";
import { BackButton } from "@/components/ui";
import { buildProfileUrl } from "@/lib/profileUrl";
import { useMeishiLibrary } from "@/lib/meishi/useMeishiLibrary";
import { useProfile } from "@/lib/useProfile";
import { useThemeColors } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";

/**
 * 名刺の全画面表示（issue #427）。一覧からタップした名刺を
 * ピンチ&ズーム対応の大きさで見せる。編集へは右上のボタンから遷移する。
 */
export default function MeishiViewerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { cards, loaded, reload } = useMeishiLibrary();
  const { data: profile } = useProfile();

  // 編集画面から戻ってきたときに保存済みの最新デザインを反映する
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const card = cards.find((c) => c.id === id) ?? null;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/meishi");
  };

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.canvasBackdrop }}
      edges={["top", "bottom", "left", "right"]}
    >
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <BackButton onPress={handleBack} accessibilityLabel={t("戻る")} />
        <Text style={styles.headerTitle} numberOfLines={1}>
          {card?.name ?? t("名刺")}
        </Text>
        {card ? (
          <Pressable
            onPress={() =>
              router.push({
                pathname: "/meishi/edit",
                params: { id: card.id },
              })
            }
            style={styles.headerBtn}
            accessibilityRole="button"
            accessibilityLabel={t("名刺を編集")}
          >
            <Ionicons name="create-outline" size={18} color={colors.text} />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {!loaded ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : card ? (
        <View style={styles.body}>
          <View style={styles.cardWrapper}>
            <MeishiCard
              username={profile?.username}
              bio={profile?.bio}
              favoriteQuote={profile?.favoriteQuote}
              profileImageUrl={profile?.profileImageUrl}
              profileUrl={buildProfileUrl(profile?.id)}
              document={card.document}
              zoomable
            />
          </View>
        </View>
      ) : (
        <View style={[styles.center, { padding: 24 }]}>
          <Text style={styles.emptyText}>
            {t("この名刺は見つかりませんでした")}
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingVertical: 8,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      flex: 1,
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
      textAlign: "center",
    },
    headerBtn: { width: 40, alignItems: "center", paddingVertical: 6 },
    headerSpacer: { width: 40 },
    body: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 12,
    },
    cardWrapper: {
      width: "100%",
      maxWidth: 720,
      borderRadius: 16,
      boxShadow: "0px 6px 16px rgba(0, 0, 0, 0.15)",
    },
    emptyText: { fontSize: 14, color: colors.textMuted },
  });
}
