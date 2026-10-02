import { forwardRef } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { pickImageUrl } from "@/lib/anime/pickImageUrl";
import type { TierRow } from "@/lib/tierList/types";

/** 画像共有でスナップショットに並べる作品。保存済み tier 表の items と同じ形。 */
export type SnapshotWork = {
  annictWorkId: number;
  tierKey: string;
  title: string;
  imageUrl?: string | null;
  resolvedImageUrl?: string | null;
};

export type TierBoardSnapshotProps = {
  title: string;
  tiers: TierRow[];
  /** position 昇順（サーバの返す順そのまま）で渡す。tierKey が tiers に無い作品は描画しない。 */
  items: SnapshotWork[];
};

/** 共有画像の横幅。作品カードは 1 行に並ぶだけ敷き詰める。 */
const SNAPSHOT_WIDTH = 640;
const CARD_SIZE = 64;

/**
 * 画像エクスポート用の表示専用 tier 表。
 * ドラッグ&ドロップ版（TierBoard）とは別物で、未分類トレイ・ハイライト・
 * ジェスチャを持たない。画面外にレンダリングして view-shot で PNG 化する。
 */
export const TierBoardSnapshot = forwardRef<View, TierBoardSnapshotProps>(
  function TierBoardSnapshot({ title, tiers, items }, ref) {
    return (
      // Android で view-shot が失敗しないよう collapsable={false} は必須
      <View ref={ref} collapsable={false} style={styles.root}>
        <Text style={styles.title}>{title}</Text>
        {tiers.map((tier) => {
          const works = items.filter((item) => item.tierKey === tier.key);
          return (
            <View key={tier.key} style={styles.row}>
              <View style={[styles.labelCell, { backgroundColor: tier.color }]}>
                <Text style={styles.labelText} numberOfLines={3}>
                  {tier.label}
                </Text>
              </View>
              <View style={styles.works}>
                {works.map((work) => {
                  const uri = pickImageUrl(work);
                  return (
                    <View key={work.annictWorkId} style={styles.card}>
                      {uri ? (
                        <Image
                          source={{ uri }}
                          style={styles.cardImage}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.cardImageFallback} />
                      )}
                      <Text style={styles.cardTitle} numberOfLines={2}>
                        {work.title}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>
    );
  },
);

const styles = StyleSheet.create({
  root: {
    width: SNAPSHOT_WIDTH,
    backgroundColor: "#111827",
    padding: 16,
    gap: 4,
  },
  title: {
    color: "#f9fafb",
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  row: { flexDirection: "row", minHeight: CARD_SIZE + 16 },
  labelCell: {
    width: 64,
    alignItems: "center",
    justifyContent: "center",
    padding: 4,
  },
  labelText: {
    color: "#1f2937",
    fontWeight: "700",
    fontSize: 16,
    textAlign: "center",
  },
  works: {
    flex: 1,
    backgroundColor: "#1f2937",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    padding: 6,
    gap: 6,
  },
  card: { width: CARD_SIZE },
  cardImage: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 4,
  },
  cardImageFallback: {
    width: CARD_SIZE,
    height: CARD_SIZE,
    borderRadius: 4,
    backgroundColor: "#4b5563",
  },
  cardTitle: {
    color: "#e5e7eb",
    fontSize: 9,
    lineHeight: 11,
    textAlign: "center",
    marginTop: 2,
  },
});
