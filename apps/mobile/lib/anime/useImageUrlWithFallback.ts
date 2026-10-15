import { useCallback, useState } from "react";
import type { PickImageUrlInput } from "./pickImageUrl";
import { pickImageUrlCandidates } from "./pickImageUrl";

// 画像コンポーネントのフォールバック用フック（issue #174 / Devin Review 指摘）。
// pickImageUrlCandidates の先頭から表示し、onError で次候補へ順に切り替える。
// これにより hostedImageUrl（自前 R2 配信）の読み込みが失敗しても、
// 外部の imageUrl / resolvedImageUrl が残っていればそちらで表示できる。
// 全候補が失敗したら uri は null になり、呼び出し側のプレースホルダーに落ちる。
export function useImageUrlWithFallback(item: PickImageUrlInput): {
  uri: string | null;
  onError: () => void;
} {
  const candidates = pickImageUrlCandidates(item);
  // item は毎レンダー新しい配列を返し得るので、候補の「内容」を join した
  // 文字列で変化を検出する。
  const candidatesKey = candidates.join("\n");
  const [state, setState] = useState({ key: candidatesKey, index: 0 });
  // 候補リストが変わったら試行位置を先頭に戻す。レンダー中の setState は
  // 同じレンダー内で反映される公式の派生 state リセットパターン
  // （useEffect での後追いリセットより余分な描画が 1 回少ない）。
  if (state.key !== candidatesKey) {
    setState({ key: candidatesKey, index: 0 });
  }
  const index = state.key === candidatesKey ? state.index : 0;
  const onError = useCallback(() => {
    setState((s) => ({ key: s.key, index: s.index + 1 }));
  }, []);
  return { uri: candidates[index] ?? null, onError };
}
