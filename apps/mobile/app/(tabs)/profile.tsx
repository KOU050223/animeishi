import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MeishiCard } from "@/components/MeishiCard";
import { useProfile, useUpdateProfile } from "@/lib/useProfile";
import { useProfileAvatarUpload } from "@/lib/useProfileAvatar";

function notifyError(message: string) {
  if (Platform.OS === "web") {
    window.alert(message);
  } else {
    Alert.alert("エラー", message);
  }
}

export default function ProfileScreen() {
  const { data: profile, isLoading, isError, refetch } = useProfile();
  const updateProfile = useUpdateProfile();
  const uploadAvatar = useProfileAvatarUpload();

  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [favoriteQuote, setFavoriteQuote] = useState("");

  // 取得したプロフィールでフォーム初期値を埋める。
  useEffect(() => {
    if (!profile) return;
    setUsername(profile.username ?? "");
    setBio(profile.bio ?? "");
    setFavoriteQuote(profile.favoriteQuote ?? "");
  }, [profile]);

  function onSave() {
    updateProfile.mutate(
      {
        username: username.trim(),
        bio: bio.trim() || undefined,
        favoriteQuote: favoriteQuote.trim() || undefined,
      },
      {
        onError: (e) =>
          notifyError(e instanceof Error ? e.message : "保存に失敗しました"),
      },
    );
  }

  function onChangeAvatar() {
    uploadAvatar.mutate(undefined, {
      onError: (e) =>
        notifyError(
          e instanceof Error ? e.message : "画像のアップロードに失敗しました",
        ),
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

      {/* 名刺プレビュー（ピンチ&ズーム可） */}
      <View className="px-4">
        <Text className="mb-2 text-xs text-gray-400">
          名刺プレビュー（ピンチで拡大）
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
    </ScrollView>
  );
}
