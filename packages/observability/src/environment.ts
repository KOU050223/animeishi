// 観測イベントに付ける environment 名。Sentry の environment に対応する。
export type AppEnvironment = "production" | "preview" | "development";

const APP_ENVIRONMENTS: readonly AppEnvironment[] = ["production", "preview", "development"];

// 環境変数など任意の文字列を AppEnvironment に正規化する。
// 未設定・未知の値は development に倒し、production / preview の
// イベントとアラート条件を汚さない。
export function resolveEnvironment(raw: string | undefined): AppEnvironment {
  return APP_ENVIRONMENTS.includes(raw as AppEnvironment) ? (raw as AppEnvironment) : "development";
}
