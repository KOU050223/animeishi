import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ScrollViewInstance,
} from "react-native";
import { useAuth } from "@clerk/expo";
import { useFocusEffect, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Ionicons } from "@expo/vector-icons";
import { Input } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { GroupedList } from "@/components/ui/grouped-list";
import { MeishiCard } from "@/components/MeishiCard";
import { AnnictConnectionCard } from "@/components/AnnictConnectionCard";
import { AnnictConnectionStatusRow } from "@/components/profile/AnnictConnectionStatusRow";
import { DeleteAccountSection } from "@/components/profile/DeleteAccountSection";
import { MalAttribution } from "@/components/profile/MalAttribution";
import { PasskeySection } from "@/components/profile/PasskeySection";
import { AppVersionFooter } from "@/components/AppVersionFooter";
import { useProfile, useUpdateProfile } from "@/lib/useProfile";
import { useProfileAvatarUpload } from "@/lib/useProfileAvatar";
import { useMeishiLibrary } from "@/lib/meishi/useMeishiLibrary";
import { buildProfileUrl } from "@/lib/profileUrl";
import { useAddToAppleWallet } from "@/lib/wallet";
import type { AddToWalletResult } from "@/lib/wallet";
import { featureFlags } from "@/lib/featureFlags";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme";
import { NowWatchingBubble } from "@/components/NowWatchingBubble";
import { AnimeWorkDetailSheet } from "@/components/anime-list";
import type { WorkDetailSheetTarget } from "@/components/anime-list";
import { useFavoriteIds, useToggleFavorite } from "@/lib/useFavorites";
import { ApiRequestError } from "@/lib/apiError";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { resolveMeishiDocument } from "@/lib/meishi/templates";
import type { ImageElement } from "@/lib/meishi/types";

type Toast = { type: "success" | "error"; message: string };

// Apple Wallet 追加の結果コードを、この画面で表示する文言へマッピングする。
// 文言は低レベル基盤 (lib/wallet) には持たせず、呼び出し側で組み立てる。
// 成功・非対応端末 (ボタン非表示) はトーストを出さないため null を返す。
function walletErrorMessage(result: AddToWalletResult): string | null {
  switch (result.type) {
    case "success":
    case "not-supported":
      return null;
    case "not-configured":
      return "サーバー側で pkpass 署名が未設定のため Wallet に追加できません";
    case "auth-failed":
      return "認証トークンが取得できませんでした";
    case "request-failed":
      return `Wallet 追加リクエストが失敗しました (${result.status})`;
  }
}

export default function ProfileScreen() {
  // iOS のネイティブヘッダーは large title 指定で透過になり、ScrollView が
  // ヘッダーの下に潜り込む。scroll inset の自動調整はトップの ScrollView に
  // 効かないケースがあるため、library / social と同じくヘッダー高さ分だけ
  // 全体を下げる（large title が畳まれると値も変わる）。Android/Web は
  // ヘッダーが不透明でコンテンツがバー下から始まるため、同じ余白を取ると
  // ヘッダー下に空白ができてしまう（issue #395 Phase 2、#491）。
  const headerHeight = useHeaderHeight();
  const contentTopPadding = Platform.OS === "ios" ? headerHeight : 0;
  const colors = useThemeColors();
  const { signOut } = useAuth();
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useProfileAvatarUpload();
  // プレビューは既定の名刺を出す（issue #427: 外に出るものはすべて既定の名刺）
  const { defaultCard: meishiDefaultCard, reload: reloadMeishi } =
    useMeishiLibrary();
  const meishiDoc = meishiDefaultCard?.document ?? null;
  const router = useRouter();
  const {
    addToWallet,
    isPending: isWalletPending,
    canUse: canUseWallet,
  } = useAddToAppleWallet();
  // pkpass 署名が未実装（#103）の間はフラグでボタン自体を出さない。
  const showWalletButton = featureFlags.wallet && canUseWallet;

  // 画面上部の連携ステータス行（#424）をタップしたとき、詳細・解除を持つ
  // 従来の連携カードの位置までスクロールするための参照。
  const scrollRef = useRef<ScrollViewInstance>(null);
  const annictCardY = useRef(0);
  const scrollToAnnictCard = useCallback(() => {
    scrollRef.current?.scrollTo({
      y: Math.max(annictCardY.current - 12, 0),
      animated: true,
    });
  }, []);

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [favoriteQuote, setFavoriteQuote] = useState("");
  // 「いま見ている」吹き出し（issue #420）から開く作品詳細シートの対象。
  const [selectedWork, setSelectedWork] =
    useState<WorkDetailSheetTarget | null>(null);
  const favoriteIds = useFavoriteIds();
  const { toggle: toggleFavorite, isPending: isTogglingFavorite } =
    useToggleFavorite(favoriteIds, {
      onError: (e) =>
        alert(
          "お気に入りを更新できませんでした",
          e instanceof ApiRequestError
            ? e.message
            : "お気に入りの更新に失敗しました",
          { okLabel: "OK" },
        ),
    });
  // 吹き出しを名刺内のアバター画像の上に重ねるため、プレビュー枠の
  // 実幅からアバター位置（document の transform はカード幅/高さに対する
  // 比率）を換算する。アバターを持たない名刺（白紙テンプレート等）では
  // カード中央上端に寄せる。
  const [meishiPreviewWidth, setMeishiPreviewWidth] = useState(0);
  const nowWatching = profile?.nowWatching ?? null;
  const nowWatchingAnchor = useMemo(() => {
    if (!nowWatching || meishiPreviewWidth <= 0) return null;
    const doc = resolveMeishiDocument(meishiDoc);
    const cardHeight = meishiPreviewWidth / doc.canvas.aspectRatio;
    const avatar = doc.elements.find(
      (el): el is ImageElement => el.type === "image" && el.source === "avatar",
    );
    if (!avatar) {
      return { left: meishiPreviewWidth / 2, bottom: cardHeight + 4 };
    }
    return {
      left:
        (avatar.transform.x + avatar.transform.width / 2) * meishiPreviewWidth,
      bottom: cardHeight - avatar.transform.y * cardHeight + 4,
    };
  }, [meishiDoc, meishiPreviewWidth, nowWatching]);

  useFocusEffect(
    useCallback(() => {
      void reloadMeishi();
      // 「いま見ている」は最新の話数記録に追従するため、フォーカスのたびに
      // プロフィールを取り直す（issue #420）。
      void refetch();
    }, [reloadMeishi, refetch]),
  );

  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((next: Toast) => {
    setToast(next);
    AccessibilityInfo.announceForAccessibility(next.message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const initialized = useRef(false);
  useEffect(() => {
    if (!profile || initialized.current) return;
    setUsername(profile.username ?? "");
    setBio(profile.bio ?? "");
    setFavoriteQuote(profile.favoriteQuote ?? "");
    initialized.current = true;
  }, [profile]);

  function onSave() {
    updateProfile.mutate(
      {
        username: username.trim(),
        bio: bio.trim() || undefined,
        favoriteQuote: favoriteQuote.trim() || undefined,
      },
      {
        onSuccess: () => {
          haptics.success();
          showToast({ type: "success", message: "プロフィールを保存しました" });
        },
        onError: (e) =>
          showToast({
            type: "error",
            message: e instanceof Error ? e.message : "保存に失敗しました",
          }),
      },
    );
  }

  function onChangeAvatar() {
    uploadAvatar.mutate(undefined, {
      onSuccess: (data) => {
        if (data) {
          haptics.success();
          showToast({ type: "success", message: "画像を更新しました" });
        }
      },
      onError: (e) =>
        showToast({
          type: "error",
          message:
            e instanceof Error ? e.message : "画像のアップロードに失敗しました",
        }),
    });
  }

  return (
    // 上端はネイティブの large title、下端はタブバーが safe area を吸収する。
    <View
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      style={{ paddingTop: contentTopPadding }}
      testID="profile-screen"
    >
      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerClassName={
          isLoading || isError
            ? "flex-1 items-center justify-center px-8"
            : "pb-12"
        }
      >
        {isLoading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : isError ? (
          <>
            <Text className="mb-4 text-center text-red-500 dark:text-red-400">
              プロフィールの取得に失敗しました
            </Text>
            <TouchableOpacity
              className="rounded-lg bg-indigo-600 px-6 py-3"
              onPress={() => refetch()}
              accessibilityRole="button"
              accessibilityLabel="プロフィールを再取得"
            >
              <Text className="font-semibold text-white">再試行</Text>
            </TouchableOpacity>
            {/* 連携の確認・解除の集約先として、プロフィール取得に失敗している間も
                解除導線を残す（ホームにはカードを出さないため）。連携カードは
                プロフィール取得とは独立したクエリで描画できる。 */}
            <View className="mt-6 self-stretch">
              <AnnictConnectionCard surface="profile_card" />
            </View>
          </>
        ) : (
          <>
            {/* 連携状態をスクロールせずに見える位置に 1 行で出す（issue #424）。
                詳細・解除は下の従来の連携カードに残す。 */}
            <View className="mb-4 px-4 pt-2">
              <AnnictConnectionStatusRow
                connectedLabel="Annict と連携済み"
                unconnectedLabel="Annict と連携していません"
                connectLabel="連携する"
                surface="profile_header"
                onShowDetails={scrollToAnnictCard}
              />
            </View>

            <View className="px-4">
              <Text className="mb-0.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                名刺プレビュー
              </Text>
              <Text className="mb-2 text-xs text-slate-400 dark:text-slate-500">
                2本指を広げると拡大できます
              </Text>
              <View
                style={styles.meishiPreviewFrame}
                testID="meishi-preview-frame"
                onLayout={(e) =>
                  setMeishiPreviewWidth(e.nativeEvent.layout.width)
                }
              >
                <MeishiCard
                  username={username || profile?.username || "ユーザー"}
                  bio={bio}
                  favoriteQuote={favoriteQuote}
                  profileImageUrl={profile?.profileImageUrl}
                  profileUrl={buildProfileUrl(profile?.id)}
                  document={meishiDoc}
                  zoomable
                />
                {/* 「いま見ている」吹き出し（issue #420）。名刺内の
                    アバター画像の上に重ね、タップで作品詳細シートを開く。 */}
                {nowWatching && nowWatchingAnchor ? (
                  <View
                    pointerEvents="box-none"
                    style={[
                      styles.nowWatchingAnchor,
                      {
                        left: nowWatchingAnchor.left,
                        bottom: nowWatchingAnchor.bottom,
                      },
                    ]}
                  >
                    <NowWatchingBubble
                      nowWatching={nowWatching}
                      onPress={() => setSelectedWork(nowWatching)}
                      testID="now-watching-bubble"
                    />
                  </View>
                ) : null}
              </View>
              <TouchableOpacity
                className="mt-3 items-center rounded-xl bg-indigo-50 dark:bg-indigo-950 py-3"
                onPress={() => router.push("/meishi")}
                accessibilityRole="button"
                accessibilityLabel="名刺一覧を開く"
              >
                <View className="flex-row items-center gap-1.5">
                  <Ionicons
                    name="albums-outline"
                    size={16}
                    color={colors.primaryText}
                  />
                  <Text className="font-semibold text-indigo-700 dark:text-indigo-300">
                    名刺一覧を開く
                  </Text>
                </View>
              </TouchableOpacity>

              {showWalletButton ? (
                <TouchableOpacity
                  testID="add-to-wallet-button"
                  // Apple Wallet ボタンはブランド上黒を維持。dark で背景に埋もれないよう枠を足す。
                  className="mt-2 items-center rounded-xl bg-black dark:border dark:border-slate-700 py-3"
                  onPress={() => {
                    void addToWallet().then((result) => {
                      const message = walletErrorMessage(result);
                      if (message) {
                        showToast({ type: "error", message });
                      }
                    });
                  }}
                  disabled={isWalletPending}
                  accessibilityRole="button"
                  accessibilityLabel="Apple Wallet に名刺を追加"
                >
                  {isWalletPending ? (
                    <ActivityIndicator color={colors.onPrimary} />
                  ) : (
                    <View className="flex-row items-center gap-1.5">
                      <Ionicons
                        name="wallet-outline"
                        size={16}
                        color={colors.onPrimary}
                      />
                      <Text className="font-semibold text-white">
                        Apple Wallet に追加
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>

            <View className="mt-6 px-4">
              <TouchableOpacity
                className="items-center rounded-xl border border-dashed border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 py-4"
                onPress={onChangeAvatar}
                disabled={uploadAvatar.isPending}
                accessibilityRole="button"
                accessibilityLabel="プロフィール画像を変更"
              >
                {uploadAvatar.isPending ? (
                  <ActivityIndicator color={colors.primaryText} />
                ) : (
                  <Text className="font-semibold text-indigo-600 dark:text-indigo-300">
                    プロフィール画像を変更
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <View className="mt-6 gap-4 px-4">
              <View>
                <Text className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  ユーザー名
                </Text>
                <Input
                  value={username}
                  onChangeText={setUsername}
                  placeholder="ユーザー名"
                  className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-slate-900 dark:text-slate-100"
                  maxLength={20}
                  accessibilityLabel="ユーザー名入力"
                />
              </View>

              <View>
                <Text className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  自己紹介
                </Text>
                <Input
                  value={bio}
                  onChangeText={setBio}
                  placeholder="自己紹介"
                  multiline
                  numberOfLines={3}
                  className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-slate-900 dark:text-slate-100"
                  maxLength={500}
                  accessibilityLabel="自己紹介入力"
                />
              </View>

              <View>
                <Text className="mb-1 text-sm font-medium text-slate-700 dark:text-slate-200">
                  好きなセリフ
                </Text>
                <Input
                  value={favoriteQuote}
                  onChangeText={setFavoriteQuote}
                  placeholder="好きなセリフ"
                  className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-slate-900 dark:text-slate-100"
                  maxLength={500}
                  accessibilityLabel="好きなセリフ入力"
                />
              </View>

              <View className="mt-2">
                <Button
                  label="保存"
                  onPress={onSave}
                  loading={updateProfile.isPending}
                  accessibilityLabel="プロフィールを保存"
                />
              </View>
            </View>

            <View
              className="mt-6 px-4"
              onLayout={(e) => {
                annictCardY.current = e.nativeEvent.layout.y;
              }}
            >
              <AnnictConnectionCard surface="profile_card" />
            </View>

            {/* パスキー登録（#181）。Web のみ。フラグ未対応環境ではセクション自体を出さない */}
            {featureFlags.passkey && (
              <View className="mt-8 px-4">
                <Text className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                  セキュリティ
                </Text>
                <PasskeySection
                  onSuccess={(message) =>
                    showToast({ type: "success", message })
                  }
                  onError={(message) => showToast({ type: "error", message })}
                />
              </View>
            )}

            {/* 設定項目のセクション一覧。ネイティブでは純正のグループ化リスト
            （@expo/ui）、Web では従来のカード行に切り替わる（issue #313）。 */}
            <GroupedList
              sections={[
                {
                  key: "analysis",
                  title: "分析",
                  rows: [
                    {
                      key: "analysis",
                      label: "AI 視聴傾向分析",
                      onPress: () => router.push("/analysis"),
                      accessibilityLabel: "AI 視聴傾向分析を開く",
                    },
                  ],
                },
                {
                  key: "achievements",
                  title: "実績",
                  rows: [
                    {
                      key: "achievements",
                      label: "実績バッジ",
                      onPress: () => router.push("/achievements"),
                      accessibilityLabel: "実績バッジ一覧を開く",
                    },
                  ],
                },
                {
                  key: "privacy-safety",
                  title: "プライバシーと安全",
                  rows: [
                    {
                      key: "blocked-users",
                      label: "ブロック中のユーザー",
                      onPress: () => router.push("/blocked-users"),
                      accessibilityLabel: "ブロック中のユーザーを開く",
                    },
                  ],
                },
                {
                  key: "about",
                  title: "このアプリについて",
                  rows: [
                    {
                      key: "changelog",
                      label: "機能一覧・更新情報",
                      onPress: () => router.push("/changelog"),
                      accessibilityLabel: "機能一覧・更新情報を開く",
                    },
                  ],
                },
                {
                  key: "legal",
                  title: "法務情報",
                  rows: [
                    {
                      key: "privacy",
                      label: "プライバシーポリシー",
                      onPress: () => router.push("/privacy"),
                      accessibilityLabel: "プライバシーポリシーを開く",
                    },
                    {
                      key: "terms",
                      label: "利用規約",
                      onPress: () => router.push("/terms"),
                      accessibilityLabel: "利用規約を開く",
                    },
                    {
                      key: "support",
                      label: "サポート",
                      onPress: () => router.push("/support"),
                      accessibilityLabel: "サポートを開く",
                    },
                  ],
                },
              ]}
            />
            <View className="px-4">
              <MalAttribution />
            </View>

            {/* サインアウトはアカウント操作なのでホームではなく設定群の末尾に
                置く（issue #395 Phase 4）。 */}
            <View className="mt-8 px-4">
              <Button
                label="サインアウト"
                icon="log-out-outline"
                variant="secondary"
                onPress={() => signOut()}
                accessibilityLabel="サインアウト"
                testID="sign-out-button"
              />
            </View>

            <DeleteAccountSection />

            <AppVersionFooter />
          </>
        )}
      </ScrollView>

      <View
        testID="profile-toast-layer"
        pointerEvents="box-none"
        style={[styles.toastLayer, { top: contentTopPadding }]}
      >
        {toast ? (
          <View
            className={`mx-4 mt-2 rounded-lg px-4 py-3 shadow-md ${
              toast.type === "success"
                ? "bg-green-50 dark:bg-green-950"
                : "bg-red-50 dark:bg-red-950"
            }`}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
          >
            <Text
              className={
                toast.type === "success"
                  ? "text-sm font-medium text-green-700 dark:text-green-300"
                  : "text-sm font-medium text-red-600 dark:text-red-400"
              }
            >
              {toast.message}
            </Text>
          </View>
        ) : null}
      </View>

      <AnimeWorkDetailSheet
        work={selectedWork}
        onClose={() => setSelectedWork(null)}
        isFavorite={
          selectedWork != null && favoriteIds.has(selectedWork.annictWorkId)
        }
        isTogglingFavorite={isTogglingFavorite}
        onToggleFavorite={() => {
          if (selectedWork) toggleFavorite(selectedWork.annictWorkId);
        }}
        onOpenCharacterTierList={(work) => {
          trackEvent("character_tier_open");
          router.push({
            pathname: "/character-tier-list",
            params: {
              workId: String(work.annictWorkId),
              workTitle: work.title,
            },
          });
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  meishiPreviewFrame: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  nowWatchingAnchor: {
    position: "absolute",
    transform: [{ translateX: "-50%" }],
    alignItems: "center",
  },
  toastLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
});
