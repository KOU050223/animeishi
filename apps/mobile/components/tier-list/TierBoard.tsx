import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import {
  DraggableWorkCard,
  type TierMoveDestination,
} from "./DraggableWorkCard";
import { DropZone } from "./DropZone";
import { useDropZoneRegistry } from "./dropZones";
import { TierLabelEditSheet } from "./TierLabelEditSheet";
import { styles } from "./tierListStyles";
import { UNASSIGNED_LABEL } from "@/lib/tierList/defaults";
import { unassignedWorks, worksInTier } from "@/lib/tierList/board";
import { tierLabelFontSize } from "@/lib/tierList/label";
import type { TierAssignment, TierRow, TierWork } from "@/lib/tierList/types";

export type TierBoardProps = {
  tiers: TierRow[];
  works: TierWork[];
  assignment: TierAssignment;
  /** ドロップ確定時。tierKey が null なら未分類トレイへ戻す。 */
  onAssign: (annictWorkId: number, tierKey: string | null) => void;
  /** tier 名の編集確定時。呼び出し側で tiers を差し替える。 */
  onRenameTier: (tierKey: string, label: string) => void;
  /**
   * tier 名の編集を受け付けるか。false の間はラベルのタップを無効化し、
   * 編集シートを開けない（共有処理中など、編集が捨てられる局面で使う）。
   */
  labelsEditable: boolean;
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
  onRenameTier,
  labelsEditable,
}: TierBoardProps) {
  const registry = useDropZoneRegistry();
  // ドラッグ中に指が乗っている行。ハイライト表示だけに使う。
  // undefined は「どの行にも乗っていない」、null は「未分類トレイの上」。
  const [hoverKey, setHoverKey] = useState<string | null | undefined>(
    undefined,
  );
  const [draggingId, setDraggingId] = useState<number | null>(null);
  // 名前編集中の tier。null のとき編集シートは閉じている。
  const [editingTier, setEditingTier] = useState<TierRow | null>(null);

  // 編集不可（共有処理中など）になったら開いているシートも閉じる。
  // 開きっぱなしにすると、確定しても捨てられる入力を残してしまう。
  useEffect(() => {
    if (!labelsEditable) setEditingTier(null);
  }, [labelsEditable]);

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

  // 支援技術からの移動用に、全 tier 行と未分類トレイを移動先として並べる。
  const moveDestinations = useMemo<TierMoveDestination[]>(
    () => [
      ...tiers.map((tier) => ({
        tierKey: tier.key as string | null,
        label: `${tier.label} に移動`,
      })),
      { tierKey: null, label: `${UNASSIGNED_LABEL} に戻す` },
    ],
    [tiers],
  );

  const renderCard = (work: TierWork, currentTierKey: string | null) => (
    <DraggableWorkCard
      key={work.annictWorkId}
      work={work}
      onDragStart={() => handleDragStart(work.annictWorkId)}
      onDragMove={handleDragMove}
      onDragEnd={(x, y) => handleDragEnd(work.annictWorkId, x, y)}
      // 今いる場所は移動先に出さない（選んでも何も起きないため）
      moveDestinations={moveDestinations.filter(
        (d) => d.tierKey !== currentTierKey,
      )}
      onMove={(tierKey) => onAssign(work.annictWorkId, tierKey)}
    />
  );

  const tray = unassignedWorks(works, assignment);

  // 編集対象は開いた時点の tier ではなく最新の tiers から引く。
  // シーズン切替などで tiers が差し替わっても、閉じるまで古い行を
  // 編集し続けて反映が消える事故を避けるため。見つからなければ閉じる。
  const editing = editingTier
    ? tiers.find((tier) => tier.key === editingTier.key)
    : undefined;

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
            <TouchableOpacity
              style={[styles.tierLabelCell, { backgroundColor: tier.color }]}
              onPress={() => setEditingTier(tier)}
              disabled={!labelsEditable}
              accessibilityRole="button"
              accessibilityLabel={`${tier.label} の名前を編集`}
              accessibilityState={{ disabled: !labelsEditable }}
              testID={`tier-label-${tier.key}`}
            >
              <Text
                style={[
                  styles.tierLabelText,
                  { fontSize: tierLabelFontSize(tier.label, 13) },
                ]}
                numberOfLines={3}
              >
                {tier.label}
              </Text>
            </TouchableOpacity>
            <DropZone
              zoneKey={tier.key}
              registry={registry}
              style={[
                styles.tierDropArea,
                hoverKey === tier.key && styles.tierDropAreaActive,
              ]}
            >
              {worksInTier(works, assignment, tier.key).map((work) =>
                renderCard(work, tier.key),
              )}
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
          tray.map((work) => renderCard(work, null))
        )}
      </DropZone>

      <TierLabelEditSheet
        visible={!!editing}
        initialValue={editing?.label ?? ""}
        onClose={() => setEditingTier(null)}
        onSubmit={(value) => {
          if (editing) onRenameTier(editing.key, value);
        }}
      />
    </ScrollView>
  );
}
