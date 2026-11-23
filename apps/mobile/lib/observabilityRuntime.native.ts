/**
 * iOS/Android: Hermes かどうかでランタイムタグを決める。
 */
export function resolveRuntime(): string {
  return (globalThis as { HermesInternal?: unknown }).HermesInternal
    ? "hermes"
    : "jsc";
}
