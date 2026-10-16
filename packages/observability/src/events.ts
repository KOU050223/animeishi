// UI イベント計測のイベント名と共通属性キー（issue #214）。
// 主要ボタンの押下回数・画面別内訳を Sentry Logs で集計する。
// 送信ロジックは apps/mobile/lib/events.ts、設計は
// docs/08_observability-design.md の「UI イベント計測」節を参照。

// イベント名。Sentry Logs の message と event.name 属性に入る。
// `<対象>_<動作>` の snake_case。新しい計測を足すときはここに追加し、
// ダッシュボード（scripts/sentry/setup-ui-events-dashboard.sh）にも
// ウィジェットを足す。
export const TRACKED_EVENTS = [
  // 名刺
  "qr_exchange_start",
  "qr_scan_start",
  "meishi_share",
  "meishi_save",
  // Tier 表
  "tier_share_open",
  "tier_share",
  "tier_image_generate",
  "tier_image_save",
  "tier_work_add_open",
  "tier_work_add",
  "character_tier_open",
  // AI 分析
  "analysis_generate",
  // 視聴ステータス
  "watch_status_change",
  // お気に入り
  "favorite_toggle",
] as const;
export type TrackedEventName = (typeof TRACKED_EVENTS)[number];

// 共通属性のキー。annict ファネルと同じく platform は接頭辞なし。
// event.name は message と同じイベント名で、ダッシュボードの group-by 軸に
// 使う（logs データセットでは message での group-by が効かないため）。
// user_key は Clerk userId のソルト付きハッシュ（PII は送らない）。
export const TRACK_EVENT_ATTRS = {
  name: "event.name",
  screen: "screen",
  appVersion: "app_version",
  userKey: "user_key",
  platform: "platform",
} as const;

// イベント固有の属性キー。各キーが取り得る値は送信箇所と docs/08 を参照。
export const TRACK_EVENT_KEYS = {
  // tier_share の共有方式: url | image | x | copy
  method: "method",
  // favorite_toggle の方向: add | remove
  action: "action",
  // watch_status_change の変更前後の state
  from: "from",
  to: "to",
  // analysis_generate の種別: initial | regenerate
  runType: "run_type",
} as const;
