import { html as honoHtml, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

export { raw };
export type { HtmlEscapedString };

/** HTML テンプレートにユーザー入力・外部データを埋め込むときのエスケープ。 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** html`` に埋め込める値。Promise は型で弾く（同期的に解決できないため）。 */
type HtmlValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | HtmlEscapedString
  | readonly HtmlValue[];

/**
 * hono/html の html を同期値専用に絞ったタグ。hono 側の型は Promise の
 * 補間を許すため戻り値が Promise との union になるが、ここでは値の型から
 * Promise を外しているので常に同期的に解決し、HtmlEscapedString が返る。
 */
export const html = honoHtml as (
  strings: TemplateStringsArray,
  ...values: HtmlValue[]
) => HtmlEscapedString;

/** エスケープ済みフラグメント同士を区切り文字で繋ぐ。 */
export function joinHtml(
  fragments: readonly HtmlEscapedString[],
  separator: string,
): HtmlEscapedString {
  return raw(fragments.join(separator));
}
