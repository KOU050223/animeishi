/**
 * fetch モックに渡された input を URL 文字列に変換する。
 * `String(input)` だと Request が "[object Request]" になるため、
 * Request は .url、URL は既定の toString で取り出す。
 */
export function requestUrl(input: RequestInfo | URL): string;
export function requestUrl(
  input: RequestInfo | URL | undefined,
): string | undefined;
export function requestUrl(
  input: RequestInfo | URL | undefined,
): string | undefined {
  if (typeof input === "string") return input;
  return input instanceof Request ? input.url : input?.toString();
}
