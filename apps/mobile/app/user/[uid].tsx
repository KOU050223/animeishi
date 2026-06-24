import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { View, Text, Image, ScrollView, ActivityIndicator } from "react-native";

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";

type PublicProfile = {
  id: string;
  username: string;
  bio: string | null;
  favoriteQuote: string | null;
  profileImageUrl: string | null;
  genres: string[];
};

async function fetchPublicProfile(uid: string): Promise<PublicProfile> {
  const res = await fetch(`${apiUrl}/user/${uid}`, {
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) throw new Error("not_found");
  if (!res.ok) throw new Error("fetch_error");
  return res.json() as Promise<PublicProfile>;
}

export default function PublicProfilePage() {
  const { uid } = useLocalSearchParams<{ uid: string }>();

  const { data, isLoading, error } = useQuery({
    queryKey: ["public-profile", uid],
    queryFn: () => fetchPublicProfile(uid),
    enabled: !!uid,
    retry: false,
  });

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error || !data) {
    const message =
      (error as Error | null)?.message === "not_found"
        ? "このプロフィールは存在しないか、非公開です。"
        : "プロフィールの取得に失敗しました。";
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-gray-500 text-center">{message}</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      <View className="items-center pt-12 pb-6 px-6">
        {data.profileImageUrl ? (
          <Image
            source={{ uri: data.profileImageUrl }}
            className="w-24 h-24 rounded-full"
            accessibilityLabel={`${data.username}のアイコン`}
          />
        ) : (
          <View className="w-24 h-24 rounded-full bg-gray-200 items-center justify-center">
            <Text className="text-3xl text-gray-400">
              {data.username.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}

        <Text className="text-2xl font-bold text-gray-900 mt-4">
          {data.username}
        </Text>

        {data.bio ? (
          <Text className="text-gray-600 text-center mt-2">{data.bio}</Text>
        ) : null}

        {data.favoriteQuote ? (
          <View className="mt-4 border-l-4 border-purple-400 pl-3 self-start">
            <Text className="text-gray-500 italic">{data.favoriteQuote}</Text>
          </View>
        ) : null}

        {data.genres.length > 0 ? (
          <View className="mt-6 self-start w-full">
            <Text className="text-sm font-semibold text-gray-700 mb-2">
              好きなジャンル
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {data.genres.map((g) => (
                <View key={g} className="bg-purple-100 rounded-full px-3 py-1">
                  <Text className="text-purple-700 text-sm">{g}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
