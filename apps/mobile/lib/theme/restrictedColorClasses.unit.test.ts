// className 直書きの色クラスのうち、WCAG コントラスト基準（#723 監査）を
// 満たさないものの再発を検出する（issue #808）。置き換え先は colors.ts の
// トークンを global.css の @theme に登録した色クラス（text-muted 等）。
// oxlint 1.89 は no-restricted-syntax 未実装のため、vitest でソースを
// 走査して検出する。
//
// 基準は満たしているがまだ直書きのクラス（text-slate-500 dark:text-slate-400
// 等）はここでは対象にしない。トークンへの置き換えは画面単位の PR で進める
// （issue #808 参照）。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// テスト・モック・生成物は画面の実装ではないため対象外。
const EXCLUDED_DIRS = new Set([
  "__mocks__",
  "__tests__",
  "e2e",
  "test-utils",
  "node_modules",
  "dist",
  "coverage",
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

// className トークンを `:` で区切ると、末尾がユーティリティ・それ以前が
// バリアント（dark:・md: 等）になる。`md:dark:text-slate-500` のように
// dark: が先頭でない並びもありうるため、バリアント列をまとめて取って判定する。
const FORBIDDEN = [
  {
    label: "text-slate-400（dark: 指定なし）",
    utility: "text-slate-400",
    isViolation: (variants: string[]) => !variants.includes("dark"),
    reason:
      "白背景でコントラスト比 2.56:1（本文基準 4.5:1 未満）。text-muted を使う",
  },
  {
    label: "text-slate-500（dark: 指定あり）",
    utility: "text-slate-500",
    isViolation: (variants: string[]) => variants.includes("dark"),
    reason:
      "暗色面でコントラスト比 3.75:1（本文基準 4.5:1 未満）。text-muted を使う",
  },
];

describe("コントラスト基準を満たさない直書き色クラス", () => {
  const files = collectSourceFiles(APP_ROOT);

  it.each(FORBIDDEN)(
    "$label を使わない",
    ({ utility, isViolation, reason }) => {
      const pattern = new RegExp(
        `(?<![\\w-])((?:[\\w-]+:)*)${utility}(?![\\w-])`,
        "g",
      );
      const violations: string[] = [];
      for (const file of files) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          for (const match of line.matchAll(pattern)) {
            const variants = (match[1] ?? "").split(":").filter(Boolean);
            if (isViolation(variants)) {
              violations.push(`${path.relative(APP_ROOT, file)}:${i + 1}`);
            }
          }
        });
      }
      expect(violations, `${reason}\n${violations.join("\n")}`).toEqual([]);
    },
  );
});
