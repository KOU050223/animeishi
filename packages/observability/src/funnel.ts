// Annict 連携ファネルの計測イベント名と属性キー（issue #64）。
// 「連携誘導の表示 → CTA タップ → OAuth 完了」のコンバージョンと
// 未連携ユーザーの離脱ポイントを Sentry Logs で集計する。
// イベントは 1 本の名前で送り、step 属性で段階を識別する。

// イベント名。Sentry Logs の Explore で `message = annict_connect_funnel` に
// 絞って step 別・surface 別に集計する想定。
export const ANNICT_FUNNEL_EVENT = "annict_connect_funnel";

// ファネルの段階。
// - prompt_view   : 連携誘導 UI（ソフトゲート/連携カード）が表示された
// - cta_tap       : 連携 CTA をタップした
// - oauth_result  : OAuth フローが結果を持って終了した（result 属性参照）
export const ANNICT_FUNNEL_STEPS = ["prompt_view", "cta_tap", "oauth_result"] as const;
export type AnnictFunnelStep = (typeof ANNICT_FUNNEL_STEPS)[number];

// oauth_result ステップの結果。cancelled はユーザーが認可を中断した離脱、
// error は reason 属性で原因を分ける（state_mismatch / exchange_failed 等）。
export const ANNICT_FUNNEL_RESULTS = ["success", "cancelled", "error"] as const;
export type AnnictFunnelResult = (typeof ANNICT_FUNNEL_RESULTS)[number];

// 誘導を表示した場所。どの画面の誘導が連携に効くか・どこで離脱するかを
// 比較するための属性。UI 側が自分の surface を指定する。
export const ANNICT_FUNNEL_SURFACES = [
  "watch_history",
  "anime_list",
  "tier_list",
  "character_tier_list",
  "custom_tier_list",
  "work_list",
  "meishi_image_library",
  "meishi_image_search",
  "home_card",
  "profile_card",
] as const;
export type AnnictFunnelSurface = (typeof ANNICT_FUNNEL_SURFACES)[number];

// 永続化経路（Web の sessionStorage 等）から来た任意文字列を
// AnnictFunnelSurface に正規化する。未知値・未設定は undefined に倒し、
// 属性自体を省略する（ダッシュボードに不規則な surface を混ぜない）。
export function normalizeAnnictFunnelSurface(
  raw: string | null | undefined,
): AnnictFunnelSurface | undefined {
  return ANNICT_FUNNEL_SURFACES.includes(raw as AnnictFunnelSurface)
    ? (raw as AnnictFunnelSurface)
    : undefined;
}

// ログ属性のキー。annict.* プレフィックスで他の属性と衝突しないようにする。
// user_key は Clerk userId のソルト付きハッシュ（PII は送らない）。
export const ANNICT_FUNNEL_ATTRS = {
  step: "annict.step",
  surface: "annict.surface",
  result: "annict.result",
  reason: "annict.reason",
  userKey: "annict.user_key",
} as const;
