import { useCallback, useEffect, useMemo, useRef } from "react";
import type { RefObject } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import type { DropZoneRegistry } from "./dropZones";

/** 指がビューポートの端からこの距離（px）以内に入ると自動スクロールを始める。 */
export const AUTO_SCROLL_EDGE_PX = 56;
/** 1 tick あたりの最大スクロール量（px）。端に近いほど速くなる。 */
export const AUTO_SCROLL_MAX_STEP_PX = 12;
/** スクロール tick の間隔（ms）。 */
export const AUTO_SCROLL_TICK_MS = 16;

/**
 * 自動スクロールの方向。
 * -1: 上端に近いので上へ（scrollY 減少）、1: 下端なので下へ、0: 端にいない。
 */
export type AutoScrollDirection = -1 | 0 | 1;

/** ScrollView のビューポート矩形（ウィンドウ座標）。measureInWindow の結果の一部。 */
export type ViewportRect = { y: number; height: number };

/**
 * 指の y 座標から自動スクロール方向を決める。
 * 指がビューポートの外に出ても（例: 盤面より上のヘッダ領域へ入っても）
 * 端を越えている限り方向を維持し、スクロールし続ける。
 */
export function autoScrollDirection(
  fingerY: number,
  viewport: ViewportRect,
): AutoScrollDirection {
  if (fingerY < viewport.y + AUTO_SCROLL_EDGE_PX) return -1;
  if (fingerY > viewport.y + viewport.height - AUTO_SCROLL_EDGE_PX) return 1;
  return 0;
}

/**
 * 1 tick で進む次のスクロールオフセット。端に近いほど速くし（リニア）、
 * コンテンツの端で clamp する。方向が 0 なら現在値をそのまま返す。
 */
export function nextScrollOffset(
  current: number,
  direction: AutoScrollDirection,
  fingerY: number,
  viewport: ViewportRect,
  maxOffset: number,
): number {
  if (direction === 0) return current;
  // 端からの侵入量を 0〜1 に正規化して速度にする。
  // ビューポート外に出ていると侵入量が EDGE を超えて 1 に張り付く＝最高速。
  const edgeDistance =
    direction > 0
      ? viewport.y + viewport.height - fingerY
      : fingerY - viewport.y;
  const ratio = Math.min(
    1,
    Math.max(0, 1 - edgeDistance / AUTO_SCROLL_EDGE_PX),
  );
  const step = Math.max(1, AUTO_SCROLL_MAX_STEP_PX * ratio);
  return Math.min(
    Math.max(0, current + direction * step),
    Math.max(0, maxOffset),
  );
}

/** scrollTo できるスクロールビューの最小形（ScrollView またはテスト用スタブ）。 */
type ScrollableView = {
  scrollTo: (options: { y: number; animated?: boolean }) => void;
};

/** measureInWindow でウィンドウ座標を測れるビューの最小形。 */
type MeasurableView = {
  measureInWindow: (
    callback: (x: number, y: number, width: number, height: number) => void,
  ) => void;
};

export type UseEdgeAutoScrollOptions = {
  /** 自動スクロールさせる ScrollView。 */
  scrollRef: RefObject<ScrollableView | null>;
  /**
   * ビューポート矩形を測る対象。ScrollView を包む View を渡す
   * （ScrollView 自身の ref には measureInWindow が無いため）。
   */
  viewportRef: RefObject<MeasurableView | null>;
  /** スクロールした分だけドロップ先矩形をずらすためのレジストリ。 */
  registry: DropZoneRegistry;
  /**
   * ドラッグ中カードを指に追従させるためのスクロール補正量。
   * 実体は reanimated の SharedValue でなければならない
   * （カード側のスタイル worklet が UI スレッドで読むため）。
   */
  scrollCompensation: { value: number };
  /**
   * 自動スクロールが実際に進んだあと、指位置つきで呼ばれる。
   * 指が止まっていてもコンテンツが指の下を通過して乗っている行が変わるため、
   * 呼び出し側はここでヒットテストをやり直す。
   */
  onScrolled?: (fingerX: number, fingerY: number) => void;
};

export type EdgeAutoScroll = {
  /** ドラッグ開始。ビューポートを測り直して tick を開始する。 */
  onDragStart: () => void;
  /** ドラッグ中の指位置（ウィンドウ座標）。端に入っている間スクロールが走る。 */
  onDragMove: (x: number, y: number) => void;
  /** ドラッグ終了・キャンセル。tick と補正量をリセットする。 */
  onDragEnd: () => void;
  /** ScrollView の onScroll に渡す。オフセットを追跡する。 */
  onScroll: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  /** ScrollView の onContentSizeChange に渡す。コンテンツ高を追跡する。 */
  onContentSizeChange: (width: number, height: number) => void;
  /** ビューポート計測。包んでいる View の onLayout からも呼ぶ。 */
  measureViewport: () => void;
};

/**
 * ドラッグ中に指がビューポート端へ近づいたとき、ScrollView を自動スクロールさせる
 * フック。未分類トレイ（盤面下部）のカードを上段の tier まで届かせるためのもの。
 *
 * ドラッグ中はユーザー操作によるスクロールを止めているため、タイマーで
 * scrollTo を叩いて進める（指を止めていても端でスクロールし続けるため）。
 * スクロールすると登録済みのドロップ矩形は画面上の位置がずれるので、進んだ分を
 * registry.shiftAll で同期補正する。measureInWindow の往復を待たずに
 * ヒットテストを正しく保つためで、実測との誤差はドラッグ終了時の
 * remeasureAll が清算する。
 */
export function useEdgeAutoScroll({
  scrollRef,
  viewportRef,
  registry,
  scrollCompensation,
  onScrolled,
}: UseEdgeAutoScrollOptions): EdgeAutoScroll {
  const scrollYRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportRectRef = useRef<ViewportRect | null>(null);
  const directionRef = useRef<AutoScrollDirection>(0);
  // 最後に報告された指位置。指を止めていても tick 側でヒットテストを
  // やり直せるよう保持する。
  const fingerRef = useRef<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // interval の依存から外すため、最新のコールバックは ref 経由で呼ぶ。
  const onScrolledRef = useRef(onScrolled);
  useEffect(() => {
    onScrolledRef.current = onScrolled;
  });

  const stopTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const measureViewport = useCallback(() => {
    viewportRef.current?.measureInWindow((_x, y, _width, height) => {
      viewportRectRef.current = { y, height };
    });
  }, [viewportRef]);

  const tick = useCallback(() => {
    const direction = directionRef.current;
    const finger = fingerRef.current;
    const viewport = viewportRectRef.current;
    if (direction === 0 || !finger || !viewport) return;
    const maxOffset = Math.max(0, contentHeightRef.current - viewport.height);
    const prev = scrollYRef.current;
    const next = nextScrollOffset(
      prev,
      direction,
      finger.y,
      viewport,
      maxOffset,
    );
    if (next === prev) return;
    scrollRef.current?.scrollTo({ y: next, animated: false });
    scrollYRef.current = next;
    const delta = next - prev;
    // コンテンツはウィンドウ座標で delta だけ上に動いた（上へ進むときは負）。
    // ヒットテストが追従するよう登録済み矩形を同じだけずらす。
    registry.shiftAll(-delta);
    // 掴んでいるカードは行と一緒に流されないよう、逆向きに補正して指に追従させる。
    scrollCompensation.value += delta;
    onScrolledRef.current?.(finger.x, finger.y);
  }, [registry, scrollRef, scrollCompensation]);

  const onDragStart = useCallback(() => {
    // 掴んだ瞬間のビューポートに合わせる。レイアウト後に高さが変わっている
    // ことがあるため onLayout の値だけには頼らない。
    measureViewport();
    scrollCompensation.value = 0;
    directionRef.current = 0;
    fingerRef.current = null;
    if (timerRef.current === null) {
      timerRef.current = setInterval(tick, AUTO_SCROLL_TICK_MS);
    }
  }, [measureViewport, scrollCompensation, tick]);

  const onDragMove = useCallback((x: number, y: number) => {
    fingerRef.current = { x, y };
    const viewport = viewportRectRef.current;
    directionRef.current = viewport ? autoScrollDirection(y, viewport) : 0;
  }, []);

  const onDragEnd = useCallback(() => {
    directionRef.current = 0;
    fingerRef.current = null;
    stopTimer();
    scrollCompensation.value = 0;
  }, [scrollCompensation, stopTimer]);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollYRef.current = event.nativeEvent.contentOffset.y;
    },
    [],
  );

  const onContentSizeChange = useCallback((_width: number, height: number) => {
    contentHeightRef.current = height;
  }, []);

  // アンマウント時に interval が残ると切り離された参照を叩き続けるため止める。
  useEffect(() => stopTimer, [stopTimer]);

  // 返り値をメモ化しておかないと、呼び出し側（TierBoard）のドラッグ系
  // コールバックが毎レンダリングで新しくなり、カード側のジェスチャ定義が
  // ドラッグの途中で作り直されて中断されうる。
  return useMemo(
    () => ({
      onDragStart,
      onDragMove,
      onDragEnd,
      onScroll,
      onContentSizeChange,
      measureViewport,
    }),
    [
      onDragStart,
      onDragMove,
      onDragEnd,
      onScroll,
      onContentSizeChange,
      measureViewport,
    ],
  );
}
