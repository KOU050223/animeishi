import { useEffect, useState } from "react";
import { subscribeFeatureFlag } from "./client";

// PostHog のリモート機能フラグ（issue #758）。取得前・取得失敗・
// キー未設定では undefined を返す。停止スイッチとして使うときは
// `=== true` のときだけ止め、取得できない場合は「止めない」側に倒す。
export function useRemoteFeatureFlag(
  key: string,
): boolean | string | undefined {
  const [value, setValue] = useState<boolean | string | undefined>(undefined);
  useEffect(() => subscribeFeatureFlag(key, setValue), [key]);
  return value;
}
