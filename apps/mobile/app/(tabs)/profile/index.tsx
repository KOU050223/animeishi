import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Input } from "@/components/ui";
import { GroupedList } from "@/components/ui/grouped-list";
import { MeishiCard } from "@/components/MeishiCard";
import { AnnictConnectionCard } from "@/components/AnnictConnectionCard";
import { DeleteAccountSection } from "@/components/profile/DeleteAccountSection";
import { MalAttribution } from "@/components/profile/MalAttribution";
import { PasskeySection } from "@/components/profile/PasskeySection";
import { AppVersionFooter } from "@/components/AppVersionFooter";
import { useProfile, useUpdateProfile } from "@/lib/useProfile";
import { useProfileAvatarUpload } from "@/lib/useProfileAvatar";
import { useMeishiDocument } from "@/lib/meishi/useMeishiDocument";
import { buildProfileUrl } from "@/lib/profileUrl";
import { useAddToAppleWallet } from "@/lib/wallet";
import type { AddToWalletResult } from "@/lib/wallet";
import { featureFlags } from "@/lib/featureFlags";
import { useThemeColors } from "@/lib/theme";

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
  const headerHeight = useHeaderHeight();
  const colors = useThemeColors();
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useProfileAvatarUpload();
  const { doc: meishiDoc, reloadDocument } = useMeishiDocument();
  const router = useRouter();
  const {
    addToWallet,
    isPending: isWalletPending,
    canUse: canUseWallet,
  } = useAddToAppleWallet();
  // pkpass 署名が未実装（#103）の間はフラグでボタン自体を出さない。
  const showWalletButton = featureFlags.wallet && canUseWallet;

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [favoriteQuote, setFavoriteQuote] = useState("");

  useFocusEffect(
    useCallback(() => {
      void reloadDocument();
    }, [reloadDocument]),
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
        onSuccess: () =>
          showToast({ type: "success", message: "プロフィールを保存しました" }),
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
    // トップに ScrollView がある画面でも large title の scroll inset が
    // 効かないケースがあるため、library / social と同じく headerHeight 分の
    // パディングでヘッダー下に潜り込むのを防ぐ（issue #395 Phase 2）。
    <View
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      style={{ paddingTop: headerHeight }}
    >
      <ScrollView
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
            <View className="px-4">
              <Text className="mb-0.5 text-sm font-medium text-slate-700 dark:text-slate-200">
                名刺プレビュー
              </Text>
              <Text className="mb-2 text-xs text-slate-400 dark:text-slate-500">
                2本指を広げると拡大できます
              </Text>
              <View style={styles.meishiPreviewFrame}>
                <MeishiCard
                  username={username || profile?.username || "ユーザー"}
                  bio={bio}
                  favoriteQuote={favoriteQuote}
                  profileImageUrl={profile?.profileImageUrl}
                  profileUrl={buildProfileUrl(profile?.id)}
                  document={meishiDoc}
                  zoomable
                />
              </View>
              <TouchableOpacity
                className="mt-3 items-center rounded-xl bg-indigo-50 dark:bg-indigo-950 py-3"
                onPress={() => router.push("/meishi/edit")}
                accessibilityRole="button"
                accessibilityLabel="名刺エディタを開く"
              >
                <Text className="font-semibold text-indigo-700 dark:text-indigo-300">
                  🎨 名刺をデザインする
                </Text>
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
                    <Text className="font-semibold text-white">
                      🍎 Apple Wallet に追加
                    </Text>
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

              <TouchableOpacity
                className="mt-2 items-center rounded-lg bg-indigo-600 py-3"
                onPress={onSave}
                disabled={updateProfile.isPending}
                accessibilityRole="button"
                accessibilityLabel="プロフィールを保存"
              >
                {updateProfile.isPending ? (
                  <ActivityIndicator color={colors.onPrimary} />
                ) : (
                  <Text className="font-semibold text-white">保存</Text>
                )}
              </TouchableOpacity>
            </View>

            <View className="mt-6 px-4">
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

            <DeleteAccountSection
              onError={(message) => showToast({ type: "error", message })}
            />

            <AppVersionFooter />
          </>
        )}
      </ScrollView>

      <View
        testID="profile-toast-layer"
        pointerEvents="box-none"
        style={[styles.toastLayer, { top: headerHeight }]}
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
    </View>
  );
}

const styles = StyleSheet.create({
  meishiPreviewFrame: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
  toastLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
  },
});
