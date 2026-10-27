import { useCallback, useMemo, useRef } from "react";

/** ウィンドウ座標系での矩形。measureInWindow の戻り値と同じ意味。 */
export type Rect = { x: number; y: number; width: number; height: number };

/**
 * ドロップ先（tier 行・未分類トレイ）の矩形を集めるレジストリ。
 *
 * ドラッグ中に「今どの行の上にいるか」を判定するには、各行の画面上の位置が要る。
 * React state に持つと計測のたびに再レンダリングが走りジェスチャがカクつくため、
 * ref に貯めて描画とは切り離す。
 *
 * tierKey は TierRow.key、未分類トレイは null をキーに使う。
 */
export type DropZoneRegistry = {
  /** 行の矩形を登録・更新する（onLayout 後の measureInWindow から呼ぶ）。 */
  register: (key: string | null, rect: Rect) => void;
  /** ウィンドウ座標の点を含む行のキーを返す。どの行にも当たらなければ undefined。 */
  hitTest: (x: number, y: number) => string | null | undefined;
  /**
   * カード（tier 行の中のアイテム）の矩形を登録・更新する。
   * 行内のどのカードの上に指があるかで挿入位置（どのカードの前後に
   * 落とすか）を決めるために使う（issue #218）。未分類トレイのカードは
   * 順序を持たないため登録しない。
   */
  registerCard: (itemId: number, rect: Rect) => void;
  /**
   * ウィンドウ座標の点を含むカードを返す。どのカードにも当たらなければ
   * undefined。excludeItemId にドラッグ中のカードを渡すとそれを除いて判定する
   * （ドラッグ中のカードは指に追従して矩形がずれ得るため、当たり判定から外す）。
   */
  hitTestCard: (
    x: number,
    y: number,
    excludeItemId?: number,
  ) => { itemId: number; rect: Rect } | undefined;
  /**
   * カードが「自分を測り直す関数」を登録する。戻り値は登録解除関数。
   * 行と同じく、スクロールでずれる矩形をドラッグ開始時に測り直すために要る。
   */
  registerCardMeasurer: (itemId: number, measure: () => void) => () => void;
  /**
   * 各 DropZone が「自分を測り直す関数」を登録する。戻り値は登録解除関数。
   * onLayout はレイアウトが変わったときしか発火しないため、スクロールで
   * 位置がずれても呼ばれない。ドラッグ開始時に remeasureAll() を通して
   * 全ゾーンを測り直すために、この登録が要る。
   */
  registerMeasurer: (key: string | null, measure: () => void) => () => void;
  /** 登録済みの全ゾーンを測り直す。ドラッグ開始時に呼ぶ。 */
  remeasureAll: () => void;
  /**
   * 登録済みの全矩形を縦にずらす。ドラッグ中の自動スクロールでコンテンツが
   * 画面上を動いた分だけ即時反映し、measureInWindow の往復を待たずに
   * ヒットテストを追従させる。dy はウィンドウ座標での移動量
   * （下にスクロールしてコンテンツが上に動いたときは負）。
   */
  shiftAll: (dy: number) => void;
  /**
   * ずらし世代。shiftAll が走るたびに 1 増える。
   * measureInWindow の応答は非同期で届くため、要求から応答までにずらしが
   * 走ると応答値がずらし前後どちらの位置を指すか分からない。計測する側は
   * 要求時と応答時でこの値を比較し、変わっていれば応答を捨てて測り直す。
   */
  epoch: () => number;
};

export function useDropZoneRegistry(): DropZoneRegistry {
  // 未分類トレイは null キーで持つ。番兵文字列を使うと、同じ文字列を key に
  // 持つ TierRow ができたときにトレイの矩形を上書きしてしまうため。
  const zonesRef = useRef(new Map<string | null, Rect>());
  const measurersRef = useRef(new Map<string | null, () => void>());
  // tier 行内のカード矩形（キーは itemId）。行内の挿入位置を決める
  // ヒットテスト専用で、行の矩形とは別に持つ。
  const cardRectsRef = useRef(new Map<number, Rect>());
  const cardMeasurersRef = useRef(new Map<number, () => void>());
  const epochRef = useRef(0);

  const register = useCallback((key: string | null, rect: Rect) => {
    zonesRef.current.set(key, rect);
  }, []);

  const registerCard = useCallback((itemId: number, rect: Rect) => {
    cardRectsRef.current.set(itemId, rect);
  }, []);

  const registerCardMeasurer = useCallback(
    (itemId: number, measure: () => void) => {
      cardMeasurersRef.current.set(itemId, measure);
      return () => {
        // 同じキーが別の measure で上書きされている場合は消さない
        // （registerMeasurer と同じ理由）。
        if (cardMeasurersRef.current.get(itemId) === measure) {
          cardMeasurersRef.current.delete(itemId);
          cardRectsRef.current.delete(itemId);
        }
      };
    },
    [],
  );

  const registerMeasurer = useCallback(
    (key: string | null, measure: () => void) => {
      measurersRef.current.set(key, measure);
      return () => {
        // 同じキーが別の measure で上書きされている場合は消さない
        // （行の入れ替えでアンマウント順が前後しても取りこぼさないため）。
        if (measurersRef.current.get(key) === measure) {
          measurersRef.current.delete(key);
          // 矩形も消す。残っていると、シーズン切替でアンマウント済みの行が
          // 同じ画面位置に追加された新しい行より先に hitTest に当たる。
          zonesRef.current.delete(key);
        }
      };
    },
    [],
  );

  const remeasureAll = useCallback(() => {
    for (const measure of measurersRef.current.values()) measure();
    for (const measure of cardMeasurersRef.current.values()) measure();
  }, []);

  const shiftAll = useCallback((dy: number) => {
    epochRef.current += 1;
    for (const [key, rect] of zonesRef.current) {
      zonesRef.current.set(key, { ...rect, y: rect.y + dy });
    }
    for (const [id, rect] of cardRectsRef.current) {
      cardRectsRef.current.set(id, { ...rect, y: rect.y + dy });
    }
  }, []);

  const epoch = useCallback(() => epochRef.current, []);

  const hitTest = useCallback((x: number, y: number) => {
    for (const [key, rect] of zonesRef.current) {
      if (
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      ) {
        return key;
      }
    }
    return undefined;
  }, []);

  const hitTestCard = useCallback(
    (x: number, y: number, excludeItemId?: number) => {
      for (const [itemId, rect] of cardRectsRef.current) {
        if (itemId === excludeItemId) continue;
        if (
          x >= rect.x &&
          x <= rect.x + rect.width &&
          y >= rect.y &&
          y <= rect.y + rect.height
        ) {
          return { itemId, rect };
        }
      }
      return undefined;
    },
    [],
  );

  // 返り値はメモ化しておかないと、呼び出し側（DropZone）の effect が
  // 親の再レンダリングのたびに cleanup → 再登録を繰り返し、
  // cleanup で矩形まで消えてドロップ判定が一切当たらなくなる。
  return useMemo(
    () => ({
      register,
      hitTest,
      registerCard,
      hitTestCard,
      registerCardMeasurer,
      registerMeasurer,
      remeasureAll,
      shiftAll,
      epoch,
    }),
    [
      register,
      hitTest,
      registerCard,
      hitTestCard,
      registerCardMeasurer,
      registerMeasurer,
      remeasureAll,
      shiftAll,
      epoch,
    ],
  );
}
