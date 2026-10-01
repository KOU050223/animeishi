// Sentry release 名のアプリ識別子。
export const RELEASE_NAMES = {
  api: "animeishi-api",
  mobile: "animeishi-mobile",
} as const;

export type ObservabilityApp = keyof typeof RELEASE_NAMES;

// "<app>@<versionId>" 形式の release 名を組み立てる。
export function buildRelease(app: ObservabilityApp, versionId: string): string {
  return `${RELEASE_NAMES[app]}@${versionId}`;
}
