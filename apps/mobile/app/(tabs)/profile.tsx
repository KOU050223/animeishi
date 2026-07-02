import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { MeishiCard } from "@/components/MeishiCard";
import { AnnictConnectionCard } from "@/components/AnnictConnectionCard";
import { useProfile, useUpdateProfile } from "@/lib/useProfile";
import { useProfileAvatarUpload } from "@/lib/useProfileAvatar";
import { useMeishiDocument } from "@/lib/meishi/useMeishiDocument";
import { buildProfileUrl } from "@/lib/profileUrl";

type Toast = { type: "success" | "error"; message: string };

export default function ProfileScreen() {
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useProfileAvatarUpload();
  const { doc: meishiDoc } = useMeishiDocument();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [favoriteQuote, setFavoriteQuote] = useState("");

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
    <View className="flex-1 bg-gray-50">
      <ScrollView className="flex-1" contentContainerClassName="pb-12">
        <View className="px-4 pb-3 pt-12">
          <Text className="text-xl font-bold text-gray-900">プロフィール</Text>
        </View>

        <View className="px-4">
          <Text className="mb-0.5 text-sm font-medium text-gray-700">
            名刺プレビュー
          </Text>
          <Text className="mb-2 text-xs text-gray-400">
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
            className="mt-3 items-center rounded-xl bg-indigo-50 py-3"
            onPress={() => router.push("/meishi/edit")}
            accessibilityRole="button"
            accessibilityLabel="名刺エディタを開く"
          >
            <Text className="font-semibold text-indigo-700">
              🎨 名刺をデザインする
            </Text>
          </TouchableOpacity>
        </View>

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

        <View className="mt-6 px-4">
          <AnnictConnectionCard />
        </View>
      </ScrollView>

      <View
        testID="profile-toast-layer"
        pointerEvents="box-none"
        style={styles.toastLayer}
      >
        {toast ? (
          <View
            className={`mx-4 mt-12 rounded-lg px-4 py-3 shadow-md ${
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
    elevation: 20,
  },
});
