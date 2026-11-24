import { useRemoteFeatureFlag } from "@/lib/analytics";
import { featureFlags } from "@/lib/featureFlags";

// リリース後の障害時に d アニメ取り込みを止める停止スイッチ（issue #758）。
// PostHog の danime_import_kill_switch が true のときだけ止める。
// フラグを取得できない（取得前・失敗・キー未設定）ときは止めない側に倒す。
export const DANIME_IMPORT_KILL_SWITCH = "danime_import_kill_switch";

// ビルド時フラグ（featureFlags.danimeImport）と停止スイッチの AND。
export function useDanimeImportEnabled(): boolean {
  const killSwitch = useRemoteFeatureFlag(DANIME_IMPORT_KILL_SWITCH);
  return featureFlags.danimeImport && killSwitch !== true;
}
