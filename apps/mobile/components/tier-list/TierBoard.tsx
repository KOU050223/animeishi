import { useCallback, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { DraggableWorkCard } from "./DraggableWorkCard";
import { DropZone } from "./DropZone";
import { useDropZoneRegistry } from "./dropZones";
import { styles } from "./tierListStyles";
import { UNASSIGNED_LABEL } from "@/lib/tierList/defaults";
import { unassignedWorks, worksInTier } from "@/lib/tierList/board";
import type { TierAssignment, TierRow, TierWork } from "@/lib/tierList/types";

export type TierBoardProps = {
  tiers: TierRow[];
  works: TierWork[];
  assignment: TierAssignment;
  /** ドロップ確定時。tierKey が null なら未分類トレイへ戻す。 */
  onAssign: (annictWorkId: number, tierKey: string | null) => void;
};

/**
 * tier 表の盤面。各 tier 行と未分類トレイがドロップ先になり、
 * 作品カードを長押しドラッグして行間を移動できる。
 *
 * 「どの行に落ちたか」の判定はここが持つ。カードは指の絶対座標を報告するだけで、
 * 行の矩形を知っているのは DropZone を並べたこのコンポーネントだからである。
 */
export function TierBoard({
  tiers,
  works,
  assignment,
  onAssign,
}: TierBoardProps) {
  const registry = useDropZoneRegistry();
  // ドラッグ中に指が乗っている行。ハイライト表示だけに使う。
  // undefined は「どの行にも乗っていない」、null は「未分類トレイの上」。
  const [hoverKey, setHoverKey] = useState<string | null | undefined>(
    undefined,
  );
  const [draggingId, setDraggingId] = useState<number | null>(null);

  const handleDragMove = useCallback(
    (x: number, y: number) => {
      const hit = registry.hitTest(x, y);
      // ハイライトは行が変わったときだけ更新する。毎フレーム setState すると
      // ドラッグ中に盤面全体が再レンダリングされてカクつく。
      setHoverKey((prev) => (prev === hit ? prev : hit));
    },
    [registry],
  );

  const handleDragEnd = useCallback(
    (workId: number, x: number, y: number) => {
      const hit = registry.hitTest(x, y);
      setHoverKey(undefined);
      setDraggingId(null);
      // どの行にも当たらなかった（盤面の外で離した）なら配置は変えない。
      if (hit === undefined) return;
      onAssign(workId, hit);
    },
    [onAssign, registry],
  );

  const handleDragStart = useCallback(
    (workId: number) => {
      setDraggingId(workId);
      // スクロールしていると onLayout 時に測った矩形が実際の位置とズレる
      // （onLayout はスクロールでは発火しない）。掴んだ瞬間に測り直して、
      // ドロップ先の判定を今の画面状態に合わせる。
      registry.remeasureAll();
    },
    [registry],
  );

  const renderCard = (work: TierWork) => (
    <DraggableWorkCard
      key={work.annictWorkId}
      work={work}
      onDragStart={() => handleDragStart(work.annictWorkId)}
      onDragMove={handleDragMove}
      onDragEnd={(x, y) => handleDragEnd(work.annictWorkId, x, y)}
    />
  );

  const tray = unassignedWorks(works, assignment);

  return (
    <ScrollView
      // ドラッグ中はスクロールを止める。長押しで掴んだ後に盤面が動くと
      // 計測済みの行の矩形とズレてドロップ先を誤判定する。
      scrollEnabled={draggingId === null}
      // スクロールが止まった時点でも測り直しておく。ドラッグ開始時にも
      // 測り直すが、こちらを入れておくと掴んだ直後の 1 フレームでも
      // 矩形が正しく、ハイライトが最初から正確に出る。
      onMomentumScrollEnd={registry.remeasureAll}
      onScrollEndDrag={registry.remeasureAll}
      scrollEventThrottle={16}
      contentContainerStyle={{ paddingBottom: 40 }}
    >
      <View style={styles.board}>
        {tiers.map((tier) => (
          <View key={tier.key} style={styles.tierRow}>
            <View
              style={[styles.tierLabelCell, { backgroundColor: tier.color }]}
            >
              <Text style={styles.tierLabelText} numberOfLines={3}>
                {tier.label}
              </Text>
            </View>
            <DropZone
              zoneKey={tier.key}
              registry={registry}
              style={[
                styles.tierDropArea,
                hoverKey === tier.key && styles.tierDropAreaActive,
              ]}
            >
              {worksInTier(works, assignment, tier.key).map(renderCard)}
            </DropZone>
          </View>
        ))}
      </View>

      <Text style={styles.trayHeader}>
        {UNASSIGNED_LABEL}（{tray.length}）
      </Text>
      <DropZone
        zoneKey={null}
        registry={registry}
        style={[styles.tray, hoverKey === null && styles.trayActive]}
      >
        {tray.length === 0 ? (
          <Text style={styles.trayEmpty}>すべての作品を配置しました</Text>
        ) : (
          tray.map(renderCard)
        )}
      </DropZone>
    </ScrollView>
  );
}
