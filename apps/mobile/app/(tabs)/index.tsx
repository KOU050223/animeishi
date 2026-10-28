import { useCallback } from "react";
import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import {
  View,
  Text,
  TouchableOpacity,
  Alert,
  ScrollView,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MeishiCard } from "@/components/MeishiCard";
import { AnnictConnectionCard } from "@/components/AnnictConnectionCard";
import { useAnnictConnection } from "@/lib/annict";
import { featureFlags } from "@/lib/featureFlags";
import { ANIME_LIST_QUERY_KEY } from "@/lib/useAnimeList";
import { useProfile } from "@/lib/useProfile";
import { useMeishiDocument } from "@/lib/meishi/useMeishiDocument";
import { buildProfileUrl } from "@/lib/profileUrl";

export default function HomeScreen() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { data: profile } = useProfile();
  const { doc: meishiDoc, reloadDocument } = useMeishiDocument();
  const { isConnected: isAnnictConnected, isLoading: isAnnictLoading } =
    useAnnictConnection();

  // 名刺エディタでの変更を戻ったときに反映するため、フォーカスごとに再読み込みする。
  useFocusEffect(
    useCallback(() => {
      void reloadDocument();
    }, [reloadDocument]),
  );

  async function clearCache() {
    await AsyncStorage.removeItem("animeishi-query-cache");
    await queryClient.resetQueries({ queryKey: ANIME_LIST_QUERY_KEY });
    Alert.alert("キャッシュクリア完了", "キャッシュをクリアしました");
  }

  return (
    // 上端だけ safe area を取る。下端はタブバー側で吸収する。
    <SafeAreaView
      className="flex-1 bg-gray-50 dark:bg-slate-950"
      edges={["top"]}
    >
      <ScrollView contentContainerClassName="px-4 pb-12">
        <View className="pb-3 pt-3">
          <Text className="text-xl font-bold text-gray-900 dark:text-slate-100">
            ホーム
          </Text>
        </View>

        <Text className="mb-2 text-sm font-medium text-gray-700 dark:text-slate-200">
          あなたの名刺
        </Text>
        <View style={styles.meishiPreviewFrame} testID="home-meishi-preview">
          <MeishiCard
            username={profile?.username || "ユーザー"}
            bio={profile?.bio}
            favoriteQuote={profile?.favoriteQuote}
            profileImageUrl={profile?.profileImageUrl}
            profileUrl={buildProfileUrl(profile?.id)}
            document={meishiDoc}
          />
        </View>

        <View className="mt-4 gap-2">
          <TouchableOpacity
            className="items-center rounded-xl bg-indigo-50 dark:bg-indigo-950 py-3"
            onPress={() => router.push("/meishi/edit")}
            accessibilityRole="button"
            accessibilityLabel="名刺をデザインする"
            testID="home-open-meishi-edit"
          >
            <Text className="font-semibold text-indigo-700 dark:text-indigo-300">
              🎨 名刺をデザインする
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="items-center rounded-xl border border-indigo-200 dark:border-indigo-700 bg-white dark:bg-slate-900 py-3"
            onPress={() => router.push("/qr")}
            accessibilityRole="button"
            accessibilityLabel="QR で名刺を交換"
            testID="home-open-qr"
          >
            <Text className="font-semibold text-indigo-700 dark:text-indigo-300">
              📷 QR で名刺を交換
            </Text>
          </TouchableOpacity>
        </View>

        {/* 連携済みユーザーには出さない（#165）。連携状態の確認・解除は
            プロフィール画面に集約する。ロード中は連携済みか未確定なため、
            一瞬カードが出て消えるちらつきを避けて描画を遅らせる。 */}
        {!isAnnictLoading && !isAnnictConnected && (
          <View className="mt-4">
            <AnnictConnectionCard surface="home_card" />
          </View>
        )}

        <TouchableOpacity
          className="mt-8 items-center rounded-lg bg-gray-200 dark:bg-slate-800 px-6 py-3"
          onPress={() => signOut()}
          testID="sign-out-button"
          accessibilityRole="button"
          accessibilityLabel="サインアウト"
        >
          <Text className="text-gray-700 dark:text-slate-200 font-semibold">
            サインアウト
          </Text>
        </TouchableOpacity>

        {featureFlags.debugPanel && (
          <View className="mt-8 p-4 border border-yellow-400 dark:border-yellow-600 rounded-xl bg-yellow-50 dark:bg-yellow-950">
            <Text className="text-yellow-700 dark:text-yellow-300 font-bold mb-2">
              Debug Panel
            </Text>
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
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  meishiPreviewFrame: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
  },
});
