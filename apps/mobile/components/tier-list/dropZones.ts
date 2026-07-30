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
};

const NULL_KEY = "__unassigned__";

export function useDropZoneRegistry(): DropZoneRegistry {
  const zonesRef = useRef(new Map<string, Rect>());

  const register = useCallback((key: string | null, rect: Rect) => {
    zonesRef.current.set(key ?? NULL_KEY, rect);
  }, []);

  const hitTest = useCallback((x: number, y: number) => {
    for (const [key, rect] of zonesRef.current) {
      if (
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height
      ) {
        return key === NULL_KEY ? null : key;
      }
    }
    return undefined;
  }, []);

  return { register, hitTest };
}
