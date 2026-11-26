import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
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
import { useMeishiLibrary } from "@/features/meishi/useMeishiLibrary";
import { useMeishiPrintExport } from "@/features/meishi/printExport";
import { useMeishiRenderContext } from "@/features/meishi/useMeishiRenderContext";
import { useProfile } from "@/features/me/useProfile";
import { useThemeColors } from "@/lib/theme";
import { useSocialLinks } from "@/features/social-links/socialLinks";
import { SocialLinksList } from "@/components/profile/SocialLinksList";
import type { ThemeColors } from "@/lib/theme";

/**
 * 名刺の全画面表示（issue #427）。一覧からタップした名刺を
 * ピンチ&ズーム対応の大きさで見せる。編集へは右上のボタンから遷移する。
 */
export default function MeishiViewerScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { cards, loaded, reload } = useMeishiLibrary();
  const { data: profile } = useProfile();
  const { data: socialLinks } = useSocialLinks();

  const cardProfile = {
    username: profile?.username,
    bio: profile?.bio,
    favoriteQuote: profile?.favoriteQuote,
    profileImageUrl: profile?.profileImageUrl,
    profileUrl: buildProfileUrl(profile?.id),
  };
  const context = useMeishiRenderContext(cardProfile);

  // 編集画面から戻ってきたときに保存済みの最新デザインを反映する。
  // useFocusEffect はコールバックの参照変化で購読し直すため、useCallback を残す。
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const card = cards.find((c) => c.id === id) ?? null;

  // 印刷用データ（表・裏の高解像度 PNG）の書き出し（issue #665）。
  const {
    exportPrintImages,
    isExporting: isPrintExporting,
    snapshotElement: printSnapshotElement,
  } = useMeishiPrintExport({ document: card?.document, context });

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
          <ActivityIndicator color={colors.primaryText} />
        </View>
      ) : card ? (
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
        >
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
          <Pressable
            onPress={() => void exportPrintImages()}
            disabled={isPrintExporting}
            style={[styles.printButton, isPrintExporting && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityLabel={t("印刷用に書き出す")}
            testID="meishi-print-export"
          >
            <Ionicons
              name="print-outline"
              size={16}
              color={colors.primaryText}
            />
            <Text style={styles.printButtonText}>
              {isPrintExporting ? t("書き出し中...") : t("印刷用に書き出す")}
            </Text>
          </Pressable>
          <SocialLinksList links={socialLinks?.items ?? []} />
        </ScrollView>
      ) : (
        <View style={[styles.center, { padding: 24 }]}>
          <Text style={styles.emptyText}>
            {t("この名刺は見つかりませんでした")}
          </Text>
        </View>
      )}
      {/* 印刷用書き出しの画面外スナップショット（実行中のみ描画される） */}
      {printSnapshotElement}
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
    },
    // SNS リンクが多いと名刺＋一覧が画面からはみ出すため縦スクロールにする
    // （issue #658）。中央寄せは一覧が短いときの見た目を維持するため
    // contentContainer の justifyContent 側で行う。
    bodyContent: {
      flexGrow: 1,
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
    printButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      marginTop: 16,
      marginBottom: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    printButtonText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.primaryText,
    },
    emptyText: { fontSize: 14, color: colors.textMuted },
  });
}
