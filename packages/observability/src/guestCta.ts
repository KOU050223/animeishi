// 未ログイン訪問者向けの登録 CTA（issue #562 / #217）の入口。
// どの入口から来た人が登録に進んだかを Sentry Logs の source 属性で比べる。
// 公開プロフィール（アプリ側）と共有ページ（API の HTML）の両方で使うため
// ここに置く。

export const GUEST_CTA_SOURCES = [
  // 名刺 QR / 共有 URL で開く公開プロフィール（/user/{id}）
  "profile",
  // API が返す共有ページ（/share/*）
  "share_tier_list",
  "share_character_tier_list",
  "share_custom_tier_list",
  "share_work_list",
  "share_watch_history",
] as const;
export type GuestCtaSource = (typeof GUEST_CTA_SOURCES)[number];

// 共有ページの CTA から Web 版の新規登録画面へ入口を渡すクエリパラメータ名。
// 共有ページは JS を使わない（issue #236）ため、タップは遷移先で計測する。
export const GUEST_CTA_SOURCE_PARAM = "from";

// URL クエリ等から来た任意文字列を GuestCtaSource に正規化する。
// 未知値は undefined に倒して計測しない（ダッシュボードに任意値を混ぜない）。
export function normalizeGuestCtaSource(
  raw: string | null | undefined,
): GuestCtaSource | undefined {
  return GUEST_CTA_SOURCES.includes(raw as GuestCtaSource) ? (raw as GuestCtaSource) : undefined;
}
