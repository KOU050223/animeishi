import { useAuth } from "@clerk/clerk-expo";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { View, Text, TouchableOpacity, Alert } from "react-native";
import { featureFlags } from "@/lib/featureFlags";
import { ANIME_LIST_QUERY_KEY } from "@/lib/useAnimeList";

export default function HomeScreen() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  async function clearCache() {
    await AsyncStorage.removeItem("animeishi-query-cache");
    await queryClient.resetQueries({ queryKey: ANIME_LIST_QUERY_KEY });
    Alert.alert("キャッシュクリア完了", "キャッシュをクリアしました");
  }

  return (
    <View className="flex-1 items-center justify-center bg-white">
      <Text className="text-2xl font-bold text-gray-900 mb-4">
        Animeishi へようこそ
      </Text>
      <TouchableOpacity
        className="bg-gray-200 rounded-lg px-6 py-3"
        onPress={() => signOut()}
        testID="sign-out-button"
        accessibilityRole="button"
        accessibilityLabel="サインアウト"
      >
        <Text className="text-gray-700 font-semibold">サインアウト</Text>
      </TouchableOpacity>

      {featureFlags.debugPanel && (
        <View className="mt-8 p-4 border border-yellow-400 rounded-xl bg-yellow-50">
          <Text className="text-yellow-700 font-bold mb-2">Debug Panel</Text>
          <TouchableOpacity
            className="bg-yellow-400 rounded-lg px-4 py-2"
            onPress={clearCache}
            accessibilityRole="button"
            accessibilityLabel="クエリキャッシュをクリア"
          >
            <Text className="text-yellow-900 font-semibold">
              QueryCache クリア
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
