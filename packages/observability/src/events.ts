// プロダクト計測のイベント名と共通属性キー（issue #214 / #758）。
// 送信先は PostHog。mobile の送信ロジックは apps/mobile/lib/events.ts、
// API 側（サーバーで成立を記録するもの）は apps/api/src/lib/posthog.ts。
// 設計は docs/08_observability-design.md の「プロダクト計測」節を参照。

// イベント名。PostHog のイベント名になる。
// `<対象>_<動作>` の snake_case。新しい計測を足すときはここに追加する。
export const TRACKED_EVENTS = [
  // リテンション・オンボーディング（issue #758）
  "app_open",
  "meishi_create",
  "annict_connect_complete",
  "danime_import_complete",
  // 名刺
  "qr_exchange_start",
  "qr_scan_start",
  "meishi_share",
  "meishi_save",
  "meishi_print_export",
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
  "recommendation_generate",
  // 視聴ステータス
  "watch_status_change",
  // 作品評価（issue #416）
  "work_rating_change",
  // 話数の視聴記録（issue #439）
  "episode_record",
  // お気に入り
  "favorite_toggle",
  // 未ログイン訪問者の登録 CTA（issue #562。source 属性で入口を分ける）
  "guest_cta_view",
  "guest_cta_tap",
  "guest_cta_return",
] as const;
export type TrackedEventName = (typeof TRACKED_EVENTS)[number];

// API が PostHog の capture API へ直接送るイベント（issue #758）。
// クライアントの送信漏れで率がぶれないよう、成立をサーバーで記録する。
export const SERVER_TRACKED_EVENTS = ["sign_up_complete", "exchange_complete"] as const;
export type ServerTrackedEventName = (typeof SERVER_TRACKED_EVENTS)[number];

// 共通属性のキー。annict ファネルと同じく platform は接頭辞なし。
// user_key は Clerk userId のソルト付きハッシュ（PII は送らない）で、
// PostHog の distinct_id と同じ値。
export const TRACK_EVENT_ATTRS = {
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
  // guest_cta_* の入口: GUEST_CTA_SOURCES（guestCta.ts）
  source: "source",
  // annict_connect_complete の誘導元: ANNICT_FUNNEL_SURFACES（funnel.ts）
  surface: "surface",
  // danime_import_complete の登録件数（成功 / 失敗・未処理）
  succeeded: "succeeded",
  failed: "failed",
  // exchange_complete の成立に使ったトークン: qr | offline
  token: "token",
} as const;
