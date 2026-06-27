import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { MeishiCard } from "@/components/MeishiCard";
import { useProfile, useUpdateProfile } from "@/lib/useProfile";
import { useProfileAvatarUpload } from "@/lib/useProfileAvatar";

type Toast = { type: "success" | "error"; message: string };

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useProfileAvatarUpload();

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [favoriteQuote, setFavoriteQuote] = useState("");

  // 保存・アップロードの結果を伝えるトースト。一定時間で自動的に消える。
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((next: Toast) => {
    setToast(next);
    // accessibilityLiveRegion は Android 専用のため、iOS(VoiceOver) でも
    // 読み上げられるよう明示的にアナウンスする。
    AccessibilityInfo.announceForAccessibility(next.message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }, []);
  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // フォームを初期化済みか。保存後の invalidate による refetch で
  // 編集中の入力がサーバ値に巻き戻らないよう、初回ロード時のみ初期化する。
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
        // 画像選択をキャンセルした場合は null が返る。その時はトーストを出さない。
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

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="mb-4 text-center text-red-500">
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
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerClassName="pb-12">
      <View className="px-4 pb-3 pt-12">
        <Text className="text-xl font-bold text-gray-900">プロフィール</Text>
      </View>

      {/* 保存・アップロード結果のトースト */}
      {toast ? (
        <View
          className={`mx-4 mb-2 rounded-lg px-4 py-3 ${
            toast.type === "success" ? "bg-green-50" : "bg-red-50"
          }`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          <Text
            className={
              toast.type === "success"
                ? "text-sm font-medium text-green-700"
                : "text-sm font-medium text-red-600"
            }
          >
            {toast.message}
          </Text>
        </View>
      ) : null}

      {/* 名刺プレビュー（ピンチ&ズーム可） */}
      <View className="px-4">
        <Text className="mb-0.5 text-sm font-medium text-gray-700">
          名刺プレビュー
        </Text>
        <Text className="mb-2 text-xs text-gray-400">
          2本指を広げると拡大できます
        </Text>
        <MeishiCard
          username={username || profile?.username || "ユーザー"}
          bio={bio}
          favoriteQuote={favoriteQuote}
          profileImageUrl={profile?.profileImageUrl}
          zoomable
        />
      </View>

      {/* アバター変更 */}
      <View className="mt-6 px-4">
        <TouchableOpacity
          className="items-center rounded-xl border border-dashed border-indigo-300 bg-white py-4"
          onPress={onChangeAvatar}
          disabled={uploadAvatar.isPending}
          accessibilityRole="button"
          accessibilityLabel="プロフィール画像を変更"
        >
          {uploadAvatar.isPending ? (
            <ActivityIndicator color="#4f46e5" />
          ) : (
            <Text className="font-semibold text-indigo-600">
              プロフィール画像を変更
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 編集フォーム */}
      <View className="mt-6 gap-4 px-4">
        <View>
          <Text className="mb-1 text-sm font-medium text-gray-700">
            ユーザー名
          </Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="ユーザー名"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-gray-900"
            maxLength={20}
            accessibilityLabel="ユーザー名入力"
          />
        </View>

        <View>
          <Text className="mb-1 text-sm font-medium text-gray-700">
            自己紹介
          </Text>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="自己紹介"
            multiline
            numberOfLines={3}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-gray-900"
            maxLength={500}
            accessibilityLabel="自己紹介入力"
          />
        </View>

        <View>
          <Text className="mb-1 text-sm font-medium text-gray-700">
            好きなセリフ
          </Text>
          <TextInput
            value={favoriteQuote}
            onChangeText={setFavoriteQuote}
            placeholder="好きなセリフ"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-gray-900"
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
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text className="font-semibold text-white">保存</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Annict 連携 */}
      <View className="mt-6 px-4">
        <TouchableOpacity
          className="flex-row items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-4"
          onPress={() => router.push("/annict")}
          accessibilityRole="button"
          accessibilityLabel="Annict 連携設定"
        >
          <View className="flex-row items-center">
            <Ionicons name="link-outline" size={20} color="#4f46e5" />
            <Text className="ml-2 font-semibold text-gray-900">
              {t("annict.title")}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}
