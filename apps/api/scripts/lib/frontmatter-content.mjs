// frontmatter 付き Markdown を D1 に投入するスクリプト群の共有部品
// （issue #437）。記事（publish-article.mjs）とイベント登録
// （publish-event.mjs、issue #411）などの運営投入コンテンツで使い回す。
//
// 使い方の例は publish-article.mjs を参照。

import { parse } from "yaml";

/**
 * `---\n<YAML>\n---\n<本文>` 形式の frontmatter 付き Markdown を
 * { attributes, body } に分解する。frontmatter が無い・YAML が
 * 壊れている場合は Error を投げる。
 * @param {string} source
 * @param {{ fileName?: string }} [opts]
 * @returns {{ attributes: Record<string, unknown>, body: string }}
 */
export function parseFrontmatterDocument(source, { fileName = "<入力>" } = {}) {
  const text = source.replace(/^\uFEFF/, "");
  // 先頭が --- の行で始まり、続く --- または ... の行で閉じるブロックだけを
  // frontmatter とみなす（本文中の --- は誤認しない）。
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[^\S\r\n]*\r?\n?/.exec(
    text,
  );
  if (!match) {
    throw new Error(`${fileName}: frontmatter（--- ... ---）が見つかりません`);
  }

  const attributes = parse(match[1]);
  if (
    attributes === null ||
    typeof attributes !== "object" ||
    Array.isArray(attributes)
  ) {
    throw new Error(
      `${fileName}: frontmatter はキー: 値 の形式で書いてください`,
    );
  }

  return { attributes, body: text.slice(match[0].length) };
}

/**
 * 値を SQL リテラルに変換する。string は単一引用符を二重化して囲む、
 * number / bigint はそのまま、null / undefined は NULL。
 * @param {string | number | bigint | null | undefined} value
 * @returns {string}
 */
export function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "bigint") {
    if (!Number.isFinite(Number(value))) {
      throw new Error(`SQL リテラルにできない数値です: ${value}`);
    }
    return String(value);
  }
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * INSERT ... ON CONFLICT DO UPDATE の upsert SQL を組み立てる。
 * - conflictColumns 以外の全列を UPDATE 対象にする
 * - keepOnUpdate に挙げた列（created_at 等）は UPDATE しない
 * @param {{
 *   table: string,
 *   conflictColumns: string[],
 *   row: Record<string, string | number | bigint | null | undefined>,
 *   keepOnUpdate?: string[],
 * }} opts
 * @returns {string}
 */
export function buildUpsertSql({
  table,
  conflictColumns,
  row,
  keepOnUpdate = [],
}) {
  const columns = Object.keys(row);
  if (columns.length === 0) {
    throw new Error("upsert する列がありません");
  }
  const updateColumns = columns.filter(
    (c) => !conflictColumns.includes(c) && !keepOnUpdate.includes(c),
  );
  if (updateColumns.length === 0) {
    throw new Error("conflict 時に更新する列がありません");
  }

  const columnList = columns.map((c) => `\`${c}\``).join(", ");
  const valueList = columns.map((c) => sqlLiteral(row[c])).join(", ");
  const conflictList = conflictColumns.map((c) => `\`${c}\``).join(", ");
  const setList = updateColumns
    .map((c) => `\`${c}\` = excluded.\`${c}\``)
    .join(", ");

  return (
    `INSERT INTO \`${table}\` (${columnList}) VALUES (${valueList}) ` +
    `ON CONFLICT (${conflictList}) DO UPDATE SET ${setList};`
  );
}

// ISO 8601 文字列の日付部分（YYYY-MM-DD）が実在する暦日かを判定する。
// Date.parse は 2026-02-30 のような存在しない日付を翌月に正規化して
// しまうため、通すと書き違えた日時が黙って登録される。日付部分を持たない
// 文字列（時刻だけの表記等）は対象外として true を返す。
function isRealCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?=T|\s|$)/.exec(value);
  if (!match) return true;
  const [year, month, day] = match.slice(1).map(Number);
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * frontmatter の日時値を unixepoch 秒に変換する。YAML の日付型で
 * Date が来る場合と文字列の場合の両方を受け付ける。空値は null。
 * @param {unknown} value
 * @param {{ field: string, required?: boolean }} opts
 * @returns {number | null}
 */
export function frontmatterDateToUnix(value, { field, required = false }) {
  if (value === undefined || value === null || value === "") {
    if (required) {
      throw new Error(`frontmatter に ${field} がありません`);
    }
    return null;
  }
  if (typeof value === "string" && !isRealCalendarDate(value)) {
    throw new Error(
      `${field} の日付が存在しません: ${JSON.stringify(value)}（実在する暦日で書いてください）`,
    );
  }
  const time =
    value instanceof Date
      ? value.getTime()
      : Date.parse(typeof value === "string" ? value : JSON.stringify(value));
  if (!Number.isFinite(time)) {
    throw new Error(
      `${field} の日時が解釈できません: ${JSON.stringify(value)}（ISO 8601 形式で書いてください）`,
    );
  }
  return Math.floor(time / 1000);
}

/**
 * 必須の文字列 frontmatter 値を取り出す。
 * @param {unknown} value
 * @param {{ field: string }} opts
 * @returns {string}
 */
export function frontmatterRequiredString(value, { field }) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`frontmatter に ${field}（文字列）がありません`);
  }
  return value;
}
