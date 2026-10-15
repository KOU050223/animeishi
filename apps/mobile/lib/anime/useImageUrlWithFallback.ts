import { useCallback, useEffect, useState } from "react";
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
  // 候補の「内容」が変わったときだけ試行位置をリセットする。
  // item は毎レンダー新しい配列を返し得るので join した文字列を依存にする。
  const candidatesKey = candidates.join("\n");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setIndex(0);
  }, [candidatesKey]);
  const onError = useCallback(() => {
    setIndex((i) => i + 1);
  }, []);
  return { uri: candidates[index] ?? null, onError };
}
