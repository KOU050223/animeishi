import { useCallback, useMemo, useRef, useState } from "react";
import {
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  type ScrollViewInstance,
  type ViewInstance,
} from "react-native";
import { useSharedValue } from "react-native-reanimated";
import { useEdgeAutoScroll } from "./autoScroll";
import {
  DraggableWorkCard,
  type TierMoveDestination,
} from "./DraggableWorkCard";
import { DropZone } from "./DropZone";
import { useDropZoneRegistry } from "./dropZones";
import { TierLabelEditSheet } from "./TierLabelEditSheet";
import { WorkAddSheet } from "./WorkAddSheet";
import { useTierListStyles } from "./tierListStyles";
import { trackEvent } from "@/lib/events";
import { UNASSIGNED_LABEL } from "@/lib/tierList/defaults";
import {
  unassignedItems,
  itemsInTier,
  dropInsertAnchor,
} from "@/lib/tierList/board";
import { tierLabelFontSize, tierLabelTextColor } from "@/lib/tierList/label";
import type { TierAssignment, TierRow, TierItem } from "@/lib/tierList/types";

export type TierBoardProps = {
  tiers: TierRow[];
  items: TierItem[];
  assignment: TierAssignment;
  /**
   * ドロップ確定時。tierKey が null なら未分類トレイへ戻す。
   * beforeItemId は行内の挿入位置（このアイテムの直前に置く）。
   * 省略時はその行の末尾に追加する（issue #218）。
   */
  onAssign: (
    itemId: number,
    tierKey: string | null,
    beforeItemId?: number,
  ) => void;
  /** tier 名の編集確定時。呼び出し側で tiers を差し替える。 */
  onRenameTier: (tierKey: string, label: string) => void;
  /**
   * 検索シートで選ばれたアイテムを未分類トレイへ追加するとき。
   * 呼び出し側で items に追加する（既にある id は無視する想定）。
   * 省略したボードでは＋ボタン自体を出さない（キャラクター tier 表は
   * 対象が作品のキャスト固定なので追加シートを持たない）。
   */
  onAddItem?: (item: TierItem) => void;
  /**
   * 盤面の編集（tier 名・作品の追加）を受け付けるか。false の間は
   * ラベルのタップと＋ボタンを無効化し、開いているシートも閉じる
   * （共有処理中など、編集が捨てられる局面で使う）。
   */
  labelsEditable: boolean;
  /** 未分類トレイが空のときに出す文言（作品/キャラクターで呼び出し側が指定）。 */
  trayEmptyLabel: string;
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
  items,
  assignment,
  onAssign,
  onRenameTier,
  onAddItem,
  labelsEditable,
  trayEmptyLabel,
}: TierBoardProps) {
  const styles = useTierListStyles();
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
  // 作品追加の検索シートが開いているか。
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  const scrollRef = useRef<ScrollViewInstance>(null);
  const viewportRef = useRef<ViewInstance>(null);
  // ドラッグ中の自動スクロール累積量。動いた分だけ掴んでいるカードを
  // 指に追従させるため、全カードへ渡してドラッグ中のものだけが加算する。
  const dragScrollCompensation = useSharedValue(0);
  // 補正を受けるカードの item id（-1 = ドラッグ中なし）。
  // 2 指で別カードを掴んだ場合、そのカードの isDragging も立つため、
  // 非アクティブ側に補正が乗らないようカード側で照合する。
  const dragOwnerId = useSharedValue(-1);

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
  // effect での同期 setState を避けるため、前回値との比較で
  // レンダー中に閉じる。
  const [prevLabelsEditable, setPrevLabelsEditable] = useState(labelsEditable);
  if (prevLabelsEditable !== labelsEditable) {
    setPrevLabelsEditable(labelsEditable);
    if (!labelsEditable) {
      setEditingTier(null);
      setAddSheetOpen(false);
    }
  }

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
    (itemId: number, x: number, y: number) => {
      // 開始を弾いたドラッグからの終了通知は、進行中のドラッグ状態を
      // 壊さないよう無視する。
      if (itemId !== draggingIdRef.current) return;
      draggingIdRef.current = null;
      dragOwnerId.set(-1);
      const hit = registry.hitTest(x, y);
      // 行内の挿入位置判定用に、指の下のカードも同じ座標で引いておく
      // （ドラッグ中のカード自身は指に追従して矩形がずれ得るため除外する）。
      const hitCard =
        typeof hit === "string"
          ? registry.hitTestCard(x, y, itemId)
          : undefined;
      setHoverKey(undefined);
      setDraggingId(null);
      autoScroll.onDragEnd();
      // 自動スクロール中は矩形をずらしているだけなので、実測値に戻して誤差を清算する。
      registry.remeasureAll();
      // どの行にも当たらなかった（盤面の外で離した）なら配置は変えない。
      if (hit === undefined) return;
      // 未分類トレイは順序を持たないため、そのまま未配置へ戻す。
      if (hit === null) {
        onAssign(itemId, null);
        return;
      }
      // 指の下のカードの前半ならそのカードの前、後半なら次のカードの前に
      // 挿入する（issue #218）。
      if (hitCard === undefined) {
        // カード以外（カードの隙間・行末の余白・掴んでいたカードの元の位置）に
        // 落とした。同じ行なら位置は変えず（元の場所に戻しただけで末尾に
        // 飛ばさない）、別の行なら従来通り末尾へ追加する。
        if (assignment.get(itemId) !== hit) onAssign(itemId, hit);
        return;
      }
      const tierIds = itemsInTier(items, assignment, hit).map(
        (item) => item.id,
      );
      const beforeItemId = dropInsertAnchor(
        tierIds,
        hitCard.itemId,
        x < hitCard.rect.x + hitCard.rect.width / 2,
      );
      // 挿入位置が今の位置かその直後（直後のカードの前半・自分が末尾での
      // 末尾追加など）なら順序は変わらない。配置が同じでも onAssign まで
      // 通すと呼び出し側で未保存フラグだけが立つため、ここで捌く。
      const fromIndex = tierIds.indexOf(itemId);
      const insertIndex =
        beforeItemId === undefined
          ? tierIds.length
          : tierIds.indexOf(beforeItemId);
      if (
        fromIndex >= 0 &&
        (insertIndex === fromIndex || insertIndex === fromIndex + 1)
      ) {
        return;
      }
      onAssign(itemId, hit, beforeItemId);
    },
    [autoScroll, assignment, dragOwnerId, items, onAssign, registry],
  );

  // ジェスチャが onEnd を通らずキャンセルされたときの後始末。
  // これを戻さないと draggingId が残り、重なり順とスクロール停止が戻らない。
  const handleDragCancel = useCallback(
    (workId: number) => {
      if (workId !== draggingIdRef.current) return;
      draggingIdRef.current = null;
      dragOwnerId.set(-1);
      setHoverKey(undefined);
      setDraggingId(null);
      autoScroll.onDragEnd();
      // キャンセルの原因が盤面のスクロール横取り等だと矩形がずれているため測り直す。
      registry.remeasureAll();
    },
    [autoScroll, dragOwnerId, registry],
  );

  const handleDragStart = useCallback(
    (itemId: number) => {
      // 別カードのドラッグ中に発火した開始（2 指操作）は無視する。
      // 受け付けると補正量やタイマーがリセットされ、進行中のカードが跳ぶ。
      if (draggingIdRef.current !== null) return;
      draggingIdRef.current = itemId;
      dragOwnerId.set(itemId);
      setDraggingId(itemId);
      // スクロールしていると onLayout 時に測った矩形が実際の位置とズレる
      // （onLayout はスクロールでは発火しない）。掴んだ瞬間に測り直して、
      // ドロップ先の判定を今の画面状態に合わせる。
      registry.remeasureAll();
      autoScroll.onDragStart();
    },
    [autoScroll, dragOwnerId, registry],
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

  const renderCard = (item: TierItem, currentTierKey: string | null) => (
    <DraggableWorkCard
      key={item.id}
      item={item}
      onDragStart={() => handleDragStart(item.id)}
      onDragMove={(x, y) => handleDragMove(item.id, x, y)}
      onDragEnd={(x, y) => handleDragEnd(item.id, x, y)}
      onDragCancel={() => handleDragCancel(item.id)}
      // 今いる場所は移動先に出さない（選んでも何も起きないため）
      moveDestinations={moveDestinations.filter(
        (d) => d.tierKey !== currentTierKey,
      )}
      onMove={(tierKey) => onAssign(item.id, tierKey)}
      scrollCompensation={dragScrollCompensation}
      scrollCompensationOwner={dragOwnerId}
      // 行内の挿入位置判定に使う矩形を登録するのは tier 行のカードだけ。
      // トレイのカードは順序を持たないため計測しない。
      registry={currentTierKey === null ? undefined : registry}
    />
  );

  const tray = unassignedItems(items, assignment);
  // 追加シートの「追加済み」判定用。盤面に載っているアイテムは再追加させない。
  const existingItemIds = useMemo(
    () => new Set(items.map((item) => item.id)),
    [items],
  );

  // ドラッグ中のカードを含む層（行・盤面・トレイ）を最前面に持ち上げる。
  // カード自身が付ける zIndex は同じ DropZone 内の兄弟にしか効かず、
  // 後に描画される下段の行や未分類トレイの下に潜ってしまう。
  // （Web では全 View が stacking context を持つため、カードの zIndex が
  // 祖先の外へは一切効かない）
  const draggingInTray =
    draggingId !== null && tray.some((item) => item.id === draggingId);
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
            const rowItems = itemsInTier(items, assignment, tier.key);
            const isDraggingRow = rowItems.some(
              (item) => item.id === draggingId,
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
                      {
                        fontSize: tierLabelFontSize(tier.label, 13),
                        color: tierLabelTextColor(tier.color),
                      },
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
                  {rowItems.map((item) => renderCard(item, tier.key))}
                </DropZone>
              </View>
            );
          })}
        </View>

        <View style={styles.trayHeaderRow}>
          <Text style={styles.trayHeader}>
            {UNASSIGNED_LABEL}（{tray.length}）
          </Text>
          {/* シーズン候補に載らない作品を検索で追加する入口（issue #168）。
              編集ロック中（共有処理中など）は無効化する。
              onAddItem を持たないボード（キャラクター tier 表）では出さない。 */}
          {onAddItem ? (
            <TouchableOpacity
              style={[
                styles.trayAddButton,
                !labelsEditable && styles.trayAddButtonDisabled,
              ]}
              onPress={() => {
                // 作品追加シートを開く操作を計測する（issue #214）。
                trackEvent("tier_work_add_open");
                setAddSheetOpen(true);
              }}
              disabled={!labelsEditable}
              accessibilityRole="button"
              accessibilityLabel="作品を検索して追加"
              accessibilityState={{ disabled: !labelsEditable }}
              testID="tier-tray-add"
            >
              <Text style={styles.trayAddButtonText}>＋ 追加</Text>
            </TouchableOpacity>
          ) : null}
        </View>
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
            <Text style={styles.trayEmpty}>
              {items.length === 0 && onAddItem
                ? "シーズンの候補がありません。＋から作品を追加できます"
                : trayEmptyLabel}
            </Text>
          ) : (
            tray.map((item) => renderCard(item, null))
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
        {onAddItem ? (
          <WorkAddSheet
            visible={addSheetOpen}
            onClose={() => setAddSheetOpen(false)}
            onAdd={onAddItem}
            existingWorkIds={existingItemIds}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
