// className 直書きの色クラスの再発を検出する（issue #808）。テキスト色は
// colors.ts のトークンを global.css の @theme に登録した色クラス
// （text-foreground / text-secondary / text-muted / text-primary-text /
// text-danger / text-success / text-success-text 等）で指定する決まりで、
// トークンで表せる色スケールの直書きは WCAG コントラスト基準（#723 監査）
// 未達のシェードを選びがちなため丸ごと禁止する。
// oxlint 1.89 は no-restricted-syntax 未実装のため、vitest でソースを
// 走査して検出する。
//
// 直書きを許す色: トークンに対応するペアがないアクセント系
// （amber / rose / purple / violet / yellow / blue / white / black と、
// 着色面上でしか使わない indigo-100/200/300/700/800/900）。
// これらを新規に使うときは背景とのコントラスト比を個別に確認すること。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// テスト・モック・生成物は画面の実装ではないため対象外。
// lib/theme/ はトークン定義で、色クラス名がコメントに出るだけなので除外する。
const EXCLUDED_DIRS = new Set([
  "__mocks__",
  "__tests__",
  "e2e",
  "test-utils",
  "node_modules",
  "dist",
  "coverage",
  "theme",
]);
const SOURCE_FILE = /\.tsx?$/;
const TEST_FILE = /\.(unit\.)?test\.tsx?$/;
const TYPE_DECLARATION = /\.d\.ts$/;

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name))
        files.push(...collectSourceFiles(full));
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !TEST_FILE.test(entry.name) &&
      !TYPE_DECLARATION.test(entry.name)
    ) {
      files.push(full);
    }
  }
  return files;
}

// utility は className トークン末尾のユーティリティ名にマッチする正規表現。
// `md:dark:` のようにバリアントが何段あっても検出する。
const FORBIDDEN = [
  {
    label: "ニュートラル系テキスト色の直書き",
    utility: "text-(?:slate|gray|zinc|neutral|stone)-\\d+",
    reason:
      "text-foreground / text-secondary / text-muted を使う（直書きは基準未達のシェードを選びやすい）",
  },
  {
    label: "red 系テキスト色の直書き",
    utility: "text-red-\\d+",
    reason: "text-danger を使う",
  },
  {
    label: "green 系テキスト色の直書き",
    utility: "text-green-\\d+",
    reason: "text-success を使う",
  },
  {
    label: "emerald 系テキスト色の直書き",
    utility: "text-emerald-\\d+",
    reason: "text-success-text を使う",
  },
  {
    label: "indigo-400/500/600 のテキスト直書き",
    utility: "text-indigo-(?:400|500|600)",
    reason:
      "text-primary-text を使う（indigo-100/900 の着色面上では text-indigo-700 dark:text-indigo-300）",
  },
];

describe("トークンで指定すべきテキスト色の直書き", () => {
  const files = collectSourceFiles(APP_ROOT);

  it.each(FORBIDDEN)("$label を使わない", ({ utility, reason }) => {
    const pattern = new RegExp(
      `(?<![\\w-])(?:[\\w-]+:)*${utility}(?![\\w-])`,
      "g",
    );
    const violations: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (pattern.test(line)) {
          violations.push(`${path.relative(APP_ROOT, file)}:${i + 1}`);
        }
      });
    }
    expect(violations, `${reason}\n${violations.join("\n")}`).toEqual([]);
  });
});
