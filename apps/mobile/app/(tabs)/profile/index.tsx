import { useCallback, useEffect, useRef, useState } from "react";
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
import { useFocusEffect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Input } from "@/components/ui";
import { ListLoadingSkeleton } from "@/components/ui/ListLoadingSkeleton";
import { Button } from "@/components/ui/Button";
import { GroupedList } from "@/components/ui/grouped-list";
import type { GroupedListRow } from "@/components/ui/grouped-list";
import { ProfileMeishiPreview } from "@/components/profile/ProfileMeishiPreview";
import { ProfileMeishiHint } from "@/components/profile/ProfileMeishiHint";
import { AnnictConnectionCard } from "@/components/AnnictConnectionCard";
import { AnnictConnectionStatusRow } from "@/components/profile/AnnictConnectionStatusRow";
import { DeleteAccountSection } from "@/components/profile/DeleteAccountSection";
import { MalAttribution } from "@/components/profile/MalAttribution";
import { PasskeySection } from "@/components/profile/PasskeySection";
import { AppVersionFooter } from "@/components/AppVersionFooter";
import { useProfile, useUpdateProfile } from "@/features/me/useProfile";
import { useSignOut } from "@/features/auth/useSignOut";
import { ApiRequestError } from "@/lib/apiError";
import { useProfileAvatarUpload } from "@/features/me/useProfileAvatar";
import { useMeishiLibrary } from "@/features/meishi/useMeishiLibrary";
import { buildProfileUrl } from "@/lib/profileUrl";
import { useAddToAppleWallet } from "@/features/pass";
import type { AddToWalletResult } from "@/features/pass";
import { featureFlags } from "@/lib/featureFlags";
import { useDanimeImportEnabled } from "@/lib/featureFlags/useDanimeImportEnabled";
import { useDanimeEpisodeJob } from "@/features/import/useDanimeImport";
import { episodeJobStatusText } from "@/features/import/episodeJobStatus";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme";
import { NowWatchingBubble } from "@/components/NowWatchingBubble";
import { AnimeWorkDetailSheet } from "@/components/anime-list";
import type { WorkDetailSheetTarget } from "@/components/anime-list";
import {
  useFavoriteIds,
  useToggleFavorite,
} from "@/features/favorites/useFavorites";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { resolveMeishiDocument } from "@/features/meishi/templates";
import type { ImageElement } from "@/features/meishi/types";
import { PublicSettingsSection } from "@/components/profile/PublicSettingsSection";
import type { PublicSettingItem } from "@/components/profile/PublicSettingsSection";
import { usePublicSettings } from "@/features/me/usePublicSettings";
import { useSocialLinks } from "@/lib/socialLinks";

type Toast = { type: "success" | "error"; message: string };

// Apple Wallet 追加の結果コードを、この画面で表示する文言へマッピングする。
// 文言は低レベル基盤 (features/pass) には持たせず、呼び出し側で組み立てる。
// 成功・非対応端末 (ボタン非表示) はトーストを出さないため null を返す。
// t はキー補完つきの厳密な型（ReturnType<typeof useTranslation>["t"]）ではなく
// TFunction で受ける。キー数が増えると厳密な型の展開が TypeScript の
// インスタンス化上限（TS2589）に達してこの呼び出しがエラーになるため
// （issue #599 で翻訳キーを追加した際に到達）。他画面の t 引数と同じ形。
function walletErrorMessage(
  result: AddToWalletResult,
  t: TFunction,
): string | null {
  switch (result.type) {
    case "success":
    case "not-supported":
      return null;
    case "not-configured":
      return t(
        "サーバー側で pkpass 署名が未設定のため Wallet に追加できません",
      );
    case "auth-failed":
      return t("認証トークンが取得できませんでした");
    case "request-failed":
      return t("Wallet 追加リクエストが失敗しました ({{status}})", {
        status: result.status,
      });
  }
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // iOS のネイティブヘッダーは large title 指定で透過になり、ScrollView が
  // ヘッダーの下に潜り込む。scroll inset の自動調整はトップの ScrollView に
  // 効かないケースがあるため、library / social と同じくヘッダー高さ分だけ
  // 全体を下げる（large title が畳まれると値も変わる）。Android/Web は
  // ヘッダーが不透明でコンテンツがバー下から始まるため、同じ余白を取ると
  // ヘッダー下に空白ができてしまう（issue #395 Phase 2、#491）。
  const headerHeight = useHeaderHeight();
  const contentTopPadding = Platform.OS === "ios" ? headerHeight : 0;
  const colors = useThemeColors();
  const signOut = useSignOut();
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const updateProfile = useUpdateProfile();
  const publicSettings = usePublicSettings();
  const { data: socialLinks } = useSocialLinks();
  // 話記録ジョブ（issue #477）の進捗。Web 版の取り込み機能が有効なときだけ取得する。
  const danimeImportEnabled = useDanimeImportEnabled();
  const { data: episodeJob } = useDanimeEpisodeJob(danimeImportEnabled);
  const uploadAvatar = useProfileAvatarUpload();
  // プレビューは既定の名刺を出す（issue #427: 外に出るものはすべて既定の名刺）
  const { defaultCard: meishiDefaultCard, reload: reloadMeishi } =
    useMeishiLibrary();
  const meishiDoc = meishiDefaultCard?.document ?? null;
  const router = useRouter();
  const contentRows: GroupedListRow[] = [
    ...(featureFlags.events
      ? [
          {
            key: "events",
            label: t("イベント"),
            onPress: () => router.push("/event"),
            accessibilityLabel: t("イベント一覧を開く"),
          },
        ]
      : []),
    ...(featureFlags.elections
      ? [
          {
            key: "elections",
            label: t("総選挙"),
            onPress: () => router.push("/election"),
            accessibilityLabel: t("総選挙一覧を開く"),
          },
        ]
      : []),
    ...(featureFlags.articles
      ? [
          {
            key: "articles",
            label: t("特集記事"),
            onPress: () => router.push("/article"),
            accessibilityLabel: t("特集記事一覧を開く"),
          },
        ]
      : []),
  ];
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
  const scrollToAnnictCard = () => {
    scrollRef.current?.scrollTo({
      y: Math.max(annictCardY.current - 12, 0),
      animated: true,
    });
  };

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [favoriteQuote, setFavoriteQuote] = useState("");
  // 「いま見ている」吹き出し（issue #420）から開く作品詳細シートの対象。
  const [selectedWork, setSelectedWork] =
    useState<WorkDetailSheetTarget | null>(null);
  const favoriteIds = useFavoriteIds();
  const { toggle: toggleFavorite, isPending: isTogglingFavorite } =
    useToggleFavorite(favoriteIds, {
      onError: () =>
        alert(t("推しを更新できませんでした"), t("推しの更新に失敗しました"), {
          okLabel: "OK",
        }),
    });
  // 吹き出しを名刺内のアバター画像の上に重ねるため、プレビュー枠の
  // 実幅からアバター位置（document の transform はカード幅/高さに対する
  // 比率）を換算する。アバターを持たない名刺（白紙テンプレート等）では
  // カード中央上端に寄せる。
  const [meishiPreviewWidth, setMeishiPreviewWidth] = useState(0);
  const nowWatching = profile?.nowWatching ?? null;
  const nowWatchingAnchor = (() => {
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
  })();

  const publicSettingItems: PublicSettingItem[] = [
    {
      key: "profile",
      label: t("プロフィールと名刺"),
      description: t(
        "公開にすると、ひろばの「みつける」に名刺が掲載され、共有リンクや名刺の公開画像から誰でもプロフィールを見られるようになります。非公開にするとこれらはすべて見られなくなります",
      ),
      visibility: publicSettings.profileVisibility,
    },
    {
      key: "social-links",
      label: t("SNS リンク"),
      description: t(
        "全体公開 {{public}}・交換した相手だけ {{friends}}・非公開 {{private}}",
        {
          public:
            socialLinks?.items.filter((item) => item.visibility === "public")
              .length ?? 0,
          friends:
            socialLinks?.items.filter((item) => item.visibility === "friends")
              .length ?? 0,
          private:
            socialLinks?.items.filter((item) => item.visibility === "private")
              .length ?? 0,
        },
      ),
      visibility: "friends",
      onPress: () => router.push("/social-links"),
    },
  ];

  // useFocusEffect はコールバックの参照変化で購読し直すため、useCallback を残す。
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
  const showToast = (next: Toast) => {
    setToast(next);
    AccessibilityInfo.announceForAccessibility(next.message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  };
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
          showToast({
            type: "success",
            message: t("プロフィールを保存しました"),
          });
        },
        // ApiRequestError には API のバリデーションメッセージが載るため
        // それを優先して出し、通信断などの素のエラーだけ汎用文言にする。
        onError: (error) =>
          showToast({
            type: "error",
            message:
              error instanceof ApiRequestError
                ? t(error.message, { defaultValue: error.message })
                : t("保存に失敗しました"),
          }),
      },
    );
  }

  function onChangeAvatar() {
    uploadAvatar.mutate(undefined, {
      onSuccess: (data) => {
        if (data) {
          haptics.success();
          showToast({ type: "success", message: t("画像を更新しました") });
        }
      },
      onError: () =>
        showToast({
          type: "error",
          message: t("画像のアップロードに失敗しました"),
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
        // 下端はネイティブのタブバーに潜り込むため、最後の要素がその下に
        // 隠れないようタブバー分の inset を余白へ足す（issue #462）。
        contentInsetAdjustmentBehavior="never"
        // 下部の入力欄（自己紹介・好きなセリフなど）がキーボードに隠れないよう、
        // iOS にキーボード分の contentInset 調整とフォーカス中入力欄への
        // 自動スクロールを任せる（issue #462）。
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={
          isLoading || (isError && !profile)
            ? styles.loadingContent
            : { paddingBottom: 48 + insets.bottom }
        }
      >
        {isLoading ? (
          <ListLoadingSkeleton accessibilityLabel={t("読み込み中")} />
        ) : isError && !profile ? (
          <>
            <Text className="mb-4 text-center text-danger">
              {t("プロフィールの取得に失敗しました")}
            </Text>
            <TouchableOpacity
              className="rounded-lg bg-indigo-600 px-6 py-3"
              onPress={() => refetch()}
              accessibilityRole="button"
              accessibilityLabel={t("プロフィールを再取得")}
            >
              <Text className="font-semibold text-white">{t("再試行")}</Text>
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
              <Text className="mb-0.5 text-sm font-medium text-secondary">
                {t("名刺プレビュー")}
              </Text>
              <ProfileMeishiHint />
              <View
                style={styles.meishiPreviewFrame}
                testID="meishi-preview-frame"
                onLayout={(e) =>
                  setMeishiPreviewWidth(e.nativeEvent.layout.width)
                }
              >
                <ProfileMeishiPreview
                  username={username || profile?.username || t("ユーザー")}
                  bio={bio}
                  favoriteQuote={favoriteQuote}
                  profileImageUrl={profile?.profileImageUrl}
                  profileUrl={buildProfileUrl(profile?.id)}
                  document={meishiDoc}
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
              {/* プレビューとエディタの名刺が同じものだと分かる説明（issue #531）。
                  公開表現は #593 の「既定の名刺を公開」に揃える。 */}
              <Text className="mt-2 text-xs text-muted">
                {t(
                  "名刺一覧で「既定」にした名刺がここに表示されます。まだ名刺が無いときは既定のデザインで表示され、公開プロフィールにも同じ名刺が出ます",
                )}
              </Text>
              <TouchableOpacity
                className="mt-3 items-center rounded-xl bg-indigo-50 dark:bg-indigo-950 py-3"
                onPress={() => router.push("/meishi")}
                accessibilityRole="button"
                accessibilityLabel={t("名刺一覧を開く")}
              >
                <View className="flex-row items-center gap-1.5">
                  <Ionicons
                    name="albums-outline"
                    size={16}
                    color={colors.primaryText}
                  />
                  <Text className="font-semibold text-indigo-700 dark:text-indigo-300">
                    {t("名刺一覧を開く")}
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
                      const message = walletErrorMessage(result, t);
                      if (message) {
                        showToast({ type: "error", message });
                      }
                    });
                  }}
                  disabled={isWalletPending}
                  accessibilityRole="button"
                  accessibilityLabel={t("Apple Wallet に名刺を追加")}
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
                        {t("Apple Wallet に追加")}
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
                accessibilityLabel={t("プロフィール画像を変更")}
              >
                {uploadAvatar.isPending ? (
                  <ActivityIndicator color={colors.primaryText} />
                ) : (
                  <Text className="font-semibold text-primary-text">
                    {t("プロフィール画像を変更")}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <View className="mt-6 gap-4 px-4">
              <View>
                <Text className="mb-1 text-sm font-medium text-secondary">
                  {t("ユーザー名")}
                </Text>
                <Input
                  value={username}
                  onChangeText={setUsername}
                  placeholder={t("ユーザー名")}
                  className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-foreground"
                  maxLength={20}
                  accessibilityLabel={t("ユーザー名入力")}
                />
              </View>

              <View>
                <Text className="mb-1 text-sm font-medium text-secondary">
                  {t("自己紹介")}
                </Text>
                <Input
                  value={bio}
                  onChangeText={setBio}
                  placeholder={t("自己紹介")}
                  multiline
                  numberOfLines={3}
                  className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-foreground"
                  maxLength={500}
                  accessibilityLabel={t("自己紹介入力")}
                />
              </View>

              <View>
                <Text className="mb-1 text-sm font-medium text-secondary">
                  {t("好きなセリフ")}
                </Text>
                <Input
                  value={favoriteQuote}
                  onChangeText={setFavoriteQuote}
                  placeholder={t("好きなセリフ")}
                  className="rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-foreground"
                  maxLength={500}
                  accessibilityLabel={t("好きなセリフ入力")}
                />
              </View>

              <View className="mt-2">
                <Button
                  label={t("保存")}
                  onPress={onSave}
                  loading={updateProfile.isPending}
                  accessibilityLabel={t("プロフィールを保存")}
                />
              </View>
            </View>

            {/* 「公開設定」セクション（issue #604）。行を足していける一覧で、
                いまは「プロフィールと名刺」（users.is_public）の 1 行だけ。 */}
            <PublicSettingsSection
              items={publicSettingItems}
              pendingKey={publicSettings.pendingKey}
              onChange={(key, visibility) => {
                void publicSettings.toggle(key, visibility).then(
                  () =>
                    showToast({
                      type: "success",
                      message: t("公開設定を更新しました"),
                    }),
                  () =>
                    showToast({
                      type: "error",
                      message: t("公開設定の更新に失敗しました"),
                    }),
                );
              }}
            />

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
                <Text className="mb-2 text-sm font-medium text-secondary">
                  {t("セキュリティ")}
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
                // 運営コンテンツの一覧への入口（issue #599）。ホームの
                // 各レールは公開中のものがあるときだけ出るため、常設の
                // 導線をここに置く。フラグで隠した機能の行は出さない（#750）。
                ...(contentRows.length > 0
                  ? [
                      {
                        key: "contents",
                        title: t("イベント・特集"),
                        rows: contentRows,
                      },
                    ]
                  : []),
                // dアニメ取り込みの導線。フラグ無効時（#751 の env 切り戻し）
                // ・停止スイッチ（#758）が入っている間はセクションごと出さない。
                ...(danimeImportEnabled
                  ? [
                      {
                        key: "import",
                        title: t("データの取り込み"),
                        rows: [
                          {
                            key: "danime-import",
                            label: t("dアニメストアから視聴履歴をインポート"),
                            onPress: () => router.push("/danime-import"),
                            accessibilityLabel: t(
                              "dアニメストアからのインポートを開く",
                            ),
                          },
                          // 話記録ジョブ（issue #477）があれば進捗行を出す。
                          // タップで取り込み画面（詳細な進捗カード）へ誘導する。
                          ...(episodeJob
                            ? [
                                {
                                  key: "danime-episode-job",
                                  label: t("話数記録: {{status}}", {
                                    status: episodeJobStatusText(episodeJob, t),
                                  }),
                                  onPress: () => router.push("/danime-import"),
                                  accessibilityLabel: t(
                                    "話数記録の進行状況を開く",
                                  ),
                                },
                              ]
                            : []),
                        ],
                      },
                    ]
                  : []),
                {
                  key: "analysis",
                  title: t("分析"),
                  rows: [
                    {
                      key: "analysis",
                      label: t("AI 視聴傾向分析"),
                      onPress: () => router.push("/analysis"),
                      accessibilityLabel: t("AI 視聴傾向分析を開く"),
                    },
                  ],
                },
                {
                  key: "achievements",
                  title: t("実績"),
                  rows: [
                    {
                      key: "achievements",
                      label: t("実績バッジ"),
                      onPress: () => router.push("/achievements"),
                      accessibilityLabel: t("実績バッジ一覧を開く"),
                    },
                  ],
                },
                {
                  key: "privacy-safety",
                  title: t("プライバシーと安全"),
                  rows: [
                    {
                      key: "blocked-users",
                      label: t("ブロック中のユーザー"),
                      onPress: () => router.push("/blocked-users"),
                      accessibilityLabel: t("ブロック中のユーザーを開く"),
                    },
                  ],
                },
                {
                  key: "about",
                  title: t("このアプリについて"),
                  rows: [
                    {
                      key: "changelog",
                      label: t("機能一覧・更新情報"),
                      onPress: () => router.push("/changelog"),
                      accessibilityLabel: t("機能一覧・更新情報を開く"),
                    },
                  ],
                },
                {
                  key: "legal",
                  title: t("法務情報"),
                  rows: [
                    {
                      key: "privacy",
                      label: t("プライバシーポリシー"),
                      onPress: () => router.push("/privacy"),
                      accessibilityLabel: t("プライバシーポリシーを開く"),
                    },
                    {
                      key: "terms",
                      label: t("利用規約"),
                      onPress: () => router.push("/terms"),
                      accessibilityLabel: t("利用規約を開く"),
                    },
                    {
                      key: "support",
                      label: t("サポート"),
                      onPress: () => router.push("/support"),
                      accessibilityLabel: t("サポートを開く"),
                    },
                  ],
                },
                // 近づけて交換の試作（issue #698）。EXPO_PUBLIC_NEARBY_SPIKE=true
                // のビルドでだけ入口を出す。通常のビルドでは見えない。
                ...(process.env.EXPO_PUBLIC_NEARBY_SPIKE === "true"
                  ? [
                      {
                        key: "dev",
                        title: t("開発（試作）"),
                        rows: [
                          {
                            key: "nearby-exchange",
                            label: t("近づけて交換（試作）"),
                            onPress: () => router.push("/dev/nearby"),
                            accessibilityLabel: t(
                              "近づけて交換の試作画面を開く",
                            ),
                          },
                          {
                            key: "nearby-exchange-stage",
                            label: t("近づけて交換の演出（試作）"),
                            onPress: () => router.push("/dev/nearby-stage"),
                            accessibilityLabel: t(
                              "近づけて交換の演出を確かめる画面を開く",
                            ),
                          },
                        ],
                      },
                    ]
                  : []),
              ]}
            />
            <View className="px-4">
              <MalAttribution />
            </View>

            {/* サインアウトはアカウント操作なのでホームではなく設定群の末尾に
                置く（issue #395 Phase 4）。 */}
            <View className="mt-8 px-4">
              <Button
                label={t("サインアウト")}
                icon="log-out-outline"
                variant="secondary"
                onPress={() => signOut()}
                accessibilityLabel={t("サインアウト")}
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
                  ? "text-sm font-medium text-success"
                  : "text-sm font-medium text-danger"
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
            pathname: "/tier-list",
            params: {
              kind: "character",
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
  loadingContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
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
