/**
 * Sentry DSN（https://<key>@<host>/<projectId>）から CSP の report-uri を組み立てる。
 * 書式は https://docs.sentry.io/security-legal-pii/security/security-policy-reporting/
 * の「Security Headers」エンドポイント。DSN が無い・解釈できない環境では
 * レポート先なしで CSP を出せるよう undefined を返す。
 */
export function buildCspReportUri(
  dsn: string | undefined,
  environment?: string,
): string | undefined {
  const parsed = parseSentryDsn(dsn);
  if (!parsed) return undefined;
  const url = new URL(`/api/${parsed.projectId}/security/`, parsed.origin);
  url.searchParams.set("sentry_key", parsed.publicKey);
  if (environment) url.searchParams.set("sentry_environment", environment);
  return url.toString();
}

/** CSP の connect-src に入れる Sentry の送信先オリジン。 */
export function sentryIngestOrigin(dsn: string | undefined): string | undefined {
  return parseSentryDsn(dsn)?.origin;
}

function parseSentryDsn(
  dsn: string | undefined,
): { origin: string; publicKey: string; projectId: string } | undefined {
  if (!dsn) return undefined;
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    return undefined;
  }
  const projectId = url.pathname.split("/").filter(Boolean).pop();
  if (url.protocol !== "https:" || !url.username || !projectId) return undefined;
  return { origin: url.origin, publicKey: url.username, projectId };
}
