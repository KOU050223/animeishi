import { useCallback, useRef } from "react";

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
   * 各 DropZone が「自分を測り直す関数」を登録する。戻り値は登録解除関数。
   * onLayout はレイアウトが変わったときしか発火しないため、スクロールで
   * 位置がずれても呼ばれない。ドラッグ開始時に remeasureAll() を通して
   * 全ゾーンを測り直すために、この登録が要る。
   */
  registerMeasurer: (key: string | null, measure: () => void) => () => void;
  /** 登録済みの全ゾーンを測り直す。ドラッグ開始時に呼ぶ。 */
  remeasureAll: () => void;
};

export function useDropZoneRegistry(): DropZoneRegistry {
  // 未分類トレイは null キーで持つ。番兵文字列を使うと、同じ文字列を key に
  // 持つ TierRow ができたときにトレイの矩形を上書きしてしまうため。
  const zonesRef = useRef(new Map<string | null, Rect>());
  const measurersRef = useRef(new Map<string | null, () => void>());

  const register = useCallback((key: string | null, rect: Rect) => {
    zonesRef.current.set(key, rect);
  }, []);

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
  }, []);

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

  return { register, hitTest, registerMeasurer, remeasureAll };
}
