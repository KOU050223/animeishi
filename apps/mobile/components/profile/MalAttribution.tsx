import { Linking, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";

// MAL API License Agreement 3(a)(xiii): MAL のデータ・画像を使うアプリは
// アプリ内にその旨の帰属表示を出す必要がある（issue #245）。
const MAL_URL = "https://myanimelist.net/";

export function MalAttribution() {
  const { t } = useTranslation();

  return (
    <View className="mt-2">
      <Text className="text-xs text-slate-400 dark:text-slate-500">
        {t("作品画像の一部は MyAnimeList から取得しています")}
      </Text>
      <TouchableOpacity
        className="mt-0.5 self-start"
        onPress={() => void Linking.openURL(MAL_URL)}
        accessibilityRole="link"
        accessibilityLabel={t("MyAnimeList を開く")}
        testID="mal-attribution-link"
      >
        <Text className="text-xs text-indigo-600 dark:text-indigo-400">
          MyAnimeList
        </Text>
      </TouchableOpacity>
    </View>
  );
}
