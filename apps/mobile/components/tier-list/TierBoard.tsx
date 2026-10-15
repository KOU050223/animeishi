import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useEdgeAutoScroll } from "./autoScroll";
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
  // ジェスチャ由来のコールバックはクロージャに古い state を掴み得るため、
  // ドラッグ中の workId は ref でも同期して持つ。
  // 2 指で別カードを同時に掴んだ場合の弾きに使う。
  const draggingIdRef = useRef<number | null>(null);
  // 名前編集中の tier。null のとき編集シートは閉じている。
  const [editingTier, setEditingTier] = useState<TierRow | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const viewportRef = useRef<View>(null);
  // ドラッグ中の自動スクロール累積量。動いた分だけ掴んでいるカードを
  // 指に追従させるため、全カードへ渡してドラッグ中のものだけが加算する。
  const dragScrollCompensation = useSharedValue(0);

  const autoScroll = useEdgeAutoScroll({
    scrollRef,
    viewportRef,
    registry,
    scrollCompensation: dragScrollCompensation,
    onScrolled: (x, y) => {
      // 指を止めていても自動スクロールで指の下の行が変わるため、
      // ずらした矩形でヒットテストをやり直してハイライトを追従させる。
      const hit = registry.hitTest(x, y);
      setHoverKey((prev) => (prev === hit ? prev : hit));
    },
  });

  // 編集不可（共有処理中など）になったら開いているシートも閉じる。
  // 開きっぱなしにすると、確定しても捨てられる入力を残してしまう。
  useEffect(() => {
    if (!labelsEditable) setEditingTier(null);
  }, [labelsEditable]);

  const handleDragMove = useCallback(
    (workId: number, x: number, y: number) => {
      // 開始を弾いたドラッグ（2 指目）からの更新は拾わない。
      if (workId !== draggingIdRef.current) return;
      autoScroll.onDragMove(x, y);
      const hit = registry.hitTest(x, y);
      // ハイライトは行が変わったときだけ更新する。毎フレーム setState すると
      // ドラッグ中に盤面全体が再レンダリングされてカクつく。
      setHoverKey((prev) => (prev === hit ? prev : hit));
    },
    [autoScroll, registry],
  );

  const handleDragEnd = useCallback(
    (workId: number, x: number, y: number) => {
      // 開始を弾いたドラッグからの終了通知は、進行中のドラッグ状態を
      // 壊さないよう無視する。
      if (workId !== draggingIdRef.current) return;
      draggingIdRef.current = null;
      const hit = registry.hitTest(x, y);
      setHoverKey(undefined);
      setDraggingId(null);
      autoScroll.onDragEnd();
      // 自動スクロール中は矩形をずらしているだけなので、実測値に戻して誤差を清算する。
      registry.remeasureAll();
      // どの行にも当たらなかった（盤面の外で離した）なら配置は変えない。
      if (hit === undefined) return;
      onAssign(workId, hit);
    },
    [autoScroll, onAssign, registry],
  );

  // ジェスチャが onEnd を通らずキャンセルされたときの後始末。
  // これを戻さないと draggingId が残り、重なり順とスクロール停止が戻らない。
  const handleDragCancel = useCallback(
    (workId: number) => {
      if (workId !== draggingIdRef.current) return;
      draggingIdRef.current = null;
      setHoverKey(undefined);
      setDraggingId(null);
      autoScroll.onDragEnd();
      // キャンセルの原因が盤面のスクロール横取り等だと矩形がずれているため測り直す。
      registry.remeasureAll();
    },
    [autoScroll, registry],
  );

  const handleDragStart = useCallback(
    (workId: number) => {
      // 別カードのドラッグ中に発火した開始（2 指操作）は無視する。
      // 受け付けると補正量やタイマーがリセットされ、進行中のカードが跳ぶ。
      if (draggingIdRef.current !== null) return;
      draggingIdRef.current = workId;
      setDraggingId(workId);
      // スクロールしていると onLayout 時に測った矩形が実際の位置とズレる
      // （onLayout はスクロールでは発火しない）。掴んだ瞬間に測り直して、
      // ドロップ先の判定を今の画面状態に合わせる。
      registry.remeasureAll();
      autoScroll.onDragStart();
    },
    [autoScroll, registry],
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
      onDragMove={(x, y) => handleDragMove(work.annictWorkId, x, y)}
      onDragEnd={(x, y) => handleDragEnd(work.annictWorkId, x, y)}
      onDragCancel={() => handleDragCancel(work.annictWorkId)}
      // 今いる場所は移動先に出さない（選んでも何も起きないため）
      moveDestinations={moveDestinations.filter(
        (d) => d.tierKey !== currentTierKey,
      )}
      onMove={(tierKey) => onAssign(work.annictWorkId, tierKey)}
      scrollCompensation={dragScrollCompensation}
    />
  );

  const tray = unassignedWorks(works, assignment);

  // ドラッグ中のカードを含む層（行・盤面・トレイ）を最前面に持ち上げる。
  // カード自身が付ける zIndex は同じ DropZone 内の兄弟にしか効かず、
  // 後に描画される下段の行や未分類トレイの下に潜ってしまう。
  // （Web では全 View が stacking context を持つため、カードの zIndex が
  // 祖先の外へは一切効かない）
  const draggingInTray =
    draggingId !== null &&
    tray.some((work) => work.annictWorkId === draggingId);
  const draggingInBoard = draggingId !== null && !draggingInTray;

  // 編集対象は開いた時点の tier ではなく最新の tiers から引く。
  // シーズン切替などで tiers が差し替わっても、閉じるまで古い行を
  // 編集し続けて反映が消える事故を避けるため。見つからなければ閉じる。
  const editing = editingTier
    ? tiers.find((tier) => tier.key === editingTier.key)
    : undefined;

  return (
    // ScrollView の ref には measureInWindow が無いため、同じ大きさの View で
    // 包んでビューポート矩形を測る。ドラッグ中の端付近ではここが起点になる
    // 自動スクロールが走る（scrollEnabled は指操作だけを止めるので、
    // scrollTo によるプログラム的なスクロールは有効）。
    <View
      ref={viewportRef}
      style={styles.boardViewport}
      onLayout={autoScroll.measureViewport}
      collapsable={false}
    >
      <ScrollView
        ref={scrollRef}
        // ドラッグ中は指によるスクロールを止める。長押しで掴んだ後に盤面が
        // 自由に動くと、掴んだもの以外の意図しないスクロールでドロップ先を
        // 誤判定するため。自動スクロールはフック側で矩形を同期補正する。
        scrollEnabled={draggingId === null}
        onScroll={autoScroll.onScroll}
        onContentSizeChange={autoScroll.onContentSizeChange}
        // スクロールが止まった時点でも測り直しておく。ドラッグ開始時にも
        // 測り直すが、こちらを入れておくと掴んだ直後の 1 フレームでも
        // 矩形が正しく、ハイライトが最初から正確に出る。
        onMomentumScrollEnd={registry.remeasureAll}
        onScrollEndDrag={registry.remeasureAll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: 40 }}
      >
        <View
          style={[styles.board, draggingInBoard && styles.draggingFront]}
          testID="tier-board"
        >
          {tiers.map((tier) => {
            const rowWorks = worksInTier(works, assignment, tier.key);
            const isDraggingRow = rowWorks.some(
              (work) => work.annictWorkId === draggingId,
            );
            return (
              <View
                key={tier.key}
                style={[styles.tierRow, isDraggingRow && styles.draggingFront]}
                testID={`tier-row-${tier.key}`}
              >
                <TouchableOpacity
                  style={[
                    styles.tierLabelCell,
                    { backgroundColor: tier.color },
                  ]}
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
                  {rowWorks.map((work) => renderCard(work, tier.key))}
                </DropZone>
              </View>
            );
          })}
        </View>

        <Text style={styles.trayHeader}>
          {UNASSIGNED_LABEL}（{tray.length}）
        </Text>
        <DropZone
          zoneKey={null}
          registry={registry}
          style={[
            styles.tray,
            hoverKey === null && styles.trayActive,
            draggingInTray && styles.draggingFront,
          ]}
          testID="tier-tray"
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
    </View>
  );
}
