import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { episodeLabel } from "@/lib/episodeLabel";
import type { NowWatching } from "@/lib/publicProfile";
import { useThemeColors } from "@/lib/theme";
import { useWorkEpisodes } from "@/lib/useWorkEpisodes";

const TAIL_WIDTH = 7;
const TAIL_HEIGHT = 7;

// 吹き出しの表示期限。API 側（findNowWatching）と同じく記録から 24 時間。
export const NOW_WATCHING_TTL_MS = 24 * 60 * 60 * 1000;

function triangle(borderTopColor: string) {
  return {
    width: 0,
    height: 0,
    borderLeftWidth: TAIL_WIDTH,
    borderRightWidth: TAIL_WIDTH,
    borderTopWidth: TAIL_HEIGHT,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderTopColor,
  };
}

/**
 * 「いま見ている」吹き出し（issue #420）。直近 24 時間の話数記録の
 * 作品タイトルを出し、タップで作品詳細シートを開く。
 *
 * 話数（"第3話" など）は D1 の episode_records が持たないため、
 * 既存の話一覧取得（GET /works/:id/episodes）から annictEpisodeId で
 * 引いて付ける。閲覧者が未サインイン・Annict 未連携などで話一覧を
 * 引けないときは「話数があれば」の仕様に従いタイトルだけを出す。
 */
export function NowWatchingBubble({
  nowWatching,
  onPress,
  testID,
}: {
  nowWatching: NowWatching;
  onPress: () => void;
  testID?: string;
}) {
  const colors = useThemeColors();
  const { data } = useWorkEpisodes(nowWatching.annictWorkId);
  // API は直近 24h の記録だけを返すが、画面を開いたまま期限を跨いでも
  // 取り直さないため、表示側でも recordedAt + 24h を過ぎたら隠す
  // （issue #420 の「一定時間で消える」）。期限到達時にタイマーで
  // 切り替え、開きっぱなしでも残らないようにする。
  const expiresAt = Date.parse(nowWatching.recordedAt) + NOW_WATCHING_TTL_MS;
  const [expired, setExpired] = useState(false);
  // 期限の違う別の記録に差し替わったときは表示に戻す
  // （effect での同期 setState を避けるため render 中に前回値と比較する。
  // danime-import-review の active リセットと同じ考え方）。
  const [prevExpiresAt, setPrevExpiresAt] = useState(expiresAt);
  if (!Object.is(prevExpiresAt, expiresAt)) {
    setPrevExpiresAt(expiresAt);
    setExpired(false);
  }
  useEffect(() => {
    // Date.now() はタイマーコールバック内でだけ読む
    const timer = setTimeout(
      () => setExpired(true),
      Math.max(0, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [expiresAt]);
  const episode = data?.episodes.find(
    (e) => e.annictEpisodeId === nowWatching.annictEpisodeId,
  );
  const label = episode
    ? `${nowWatching.title} ${episodeLabel(episode)}`
    : nowWatching.title;

  if (expired) return null;

  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`いま見ている作品 ${label} の詳細を開く`}
      testID={testID}
      style={styles.container}
    >
      <View
        className="flex-row items-center rounded-full border px-3 py-1.5"
        style={{
          backgroundColor: colors.primarySoft,
          borderColor: colors.primaryBorder,
        }}
      >
        <Ionicons name="play" size={11} color={colors.primaryText} />
        <Text
          numberOfLines={1}
          className="ml-1 text-xs font-semibold"
          style={[styles.label, { color: colors.primaryText }]}
        >
          {label}
        </Text>
      </View>
      {/* プロフィール画像を指す吹き出しの尻尾。外側を枠色・内側を背景色に
          ずらして重ね、枠線付きの吹き出しに見せる。 */}
      <View style={styles.tail}>
        <View style={triangle(colors.primaryBorder)} />
        <View style={[triangle(colors.primarySoft), styles.tailInner]} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
  },
  label: {
    maxWidth: 220,
  },
  tail: {
    marginTop: -1,
    height: TAIL_HEIGHT,
    alignItems: "center",
  },
  tailInner: {
    position: "absolute",
    top: -1,
  },
});
