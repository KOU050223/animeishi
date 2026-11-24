// ソース中の t() キーと en 翻訳リソースの差分を検証する（issue #739）。
// キーは日本語文言そのもの（t("削除する")）なので、ソースを AST 走査して
// t() 呼び出しの第 1 引数に含まれる文字列リテラルを「必須キー」として抽出する。
//
// 抽出できないもの（対象外）:
// - t(e.message) や t(map[key]) のような動的キー。実際の文言リテラルは
//   別モジュールにあるか実行時データ由来のため静的に特定できない。
//   ただし未使用キーの判定ではソース内の全文字列リテラルを「使用中」とみなす
//   （キー=日本語文言なので、どこかにリテラルとして書かれていれば使われている可能性がある）。
// - `as TranslationKey` キャストで t() に渡される文字列（valibot のバリデーション
//   メッセージなど）。TranslationKey は keyof typeof en のため、型注釈・型付きの
//   Record 経由のキーは tsc（vp run typecheck）側で既に en への存在が強制される。
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import en from "./locales/en/translation.json";
import filterEn from "./locales/en/animeListFilterTranslation.json";

const APP_ROOT = fileURLToPath(new URL("../..", import.meta.url));

// テスト専用コードは「実行時に使われるキー」の基準にならないため除外する。
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

function isTranslationCall(node: ts.Node): node is ts.CallExpression {
  if (!ts.isCallExpression(node) || node.arguments.length === 0) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === "t";
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === "t" &&
    ts.isIdentifier(callee.expression) &&
    (callee.expression.text === "i18n" || callee.expression.text === "i18next")
  );
}

// 三項演算子の条件部（state === "saving" 等）はキーにならないので枝だけを辿る。
// ?? / || / ?.[] など、実際に t() に渡りうる値を構成する式はすべて辿る。
function collectStringLiterals(node: ts.Node, out: Set<string>): void {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.add(node.text);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectStringLiterals(node.whenTrue, out);
    collectStringLiterals(node.whenFalse, out);
    return;
  }
  if (ts.isPropertyAssignment(node)) {
    collectStringLiterals(node.initializer, out);
    return;
  }
  ts.forEachChild(node, (child) => collectStringLiterals(child, out));
}

const enKeys = new Set([...Object.keys(en), ...Object.keys(filterEn)]);
// en の i18next 複数形サフィックス（en は one / other の 2 形）。
const PLURAL_SUFFIXES = ["_one", "_other"];
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

// オプション引数に count プロパティがある呼び出しは複数形解決（X_one / X_other）
// になる。変数経由のオプションは count の有無が分からないので非 count 扱いに倒す。
function hasCountOption(node: ts.CallExpression): boolean {
  return node.arguments
    .slice(1)
    .some(
      (arg) =>
        ts.isObjectLiteralExpression(arg) &&
        arg.properties.some(
          (prop) =>
            (ts.isPropertyAssignment(prop) ||
              ts.isShorthandPropertyAssignment(prop)) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === "count",
        ),
    );
}

interface KeyUse {
  locations: string[];
  hasNonCountCall: boolean;
}

// t("X") は基底の X を、t("X", { count }) は X_one / X_other を en から解決する。
// 基底 X があるか、count 付き呼び出しにだけ使われ複数形ペアが揃っていれば翻訳済みとみなす。
function isTranslated(key: string, use: KeyUse): boolean {
  return (
    enKeys.has(key) ||
    (!use.hasNonCountCall && PLURAL_SUFFIXES.every((s) => enKeys.has(key + s)))
  );
}

const requiredKeys = new Map<string, KeyUse>();
const allLiterals = new Set<string>();

for (const file of collectSourceFiles(APP_ROOT)) {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node): void => {
    if (isTranslationCall(node)) {
      const literals = new Set<string>();
      collectStringLiterals(node.arguments[0]!, literals);
      const location = `${path.relative(APP_ROOT, file)}:${
        source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      }`;
      for (const key of literals) {
        const use = requiredKeys.get(key) ?? {
          locations: [],
          hasNonCountCall: false,
        };
        use.locations.push(location);
        if (!hasCountOption(node)) use.hasNonCountCall = true;
        requiredKeys.set(key, use);
      }
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      allLiterals.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

describe("ソースの t() キーと en 翻訳の差分（issue #739）", () => {
  it("ソースからキーが抽出できている（探索が壊れても空成功しない）", () => {
    expect(requiredKeys.size).toBeGreaterThan(100);
  });

  it("t() に直接渡されるリテラルキーはすべて en に英訳がある", () => {
    const missing = [...requiredKeys]
      .filter(([key, use]) => !isTranslated(key, use))
      .map(
        ([key, use]) => `${JSON.stringify(key)} @ ${use.locations.join(", ")}`,
      )
      .sort();
    expect(missing).toEqual([]);
  });

  it("使われていない en キーを警告で一覧する（削除はしない）", () => {
    const usedKeys = new Set([...requiredKeys.keys(), ...allLiterals]);
    const unused = [...enKeys]
      .filter((key) => {
        if (usedKeys.has(key)) return false;
        // 複数形キーは基底キーが使われていれば使用中とみなす。
        const base = key.replace(PLURAL_SUFFIX, "");
        return base === key || !usedKeys.has(base);
      })
      .sort();
    if (unused.length > 0) {
      console.warn(
        `[i18n] ソース中にリテラルとして現れない en キーが ${unused.length} 件あります` +
          `（実行時データ由来・削除忘れの可能性）:\n${unused
            .map((key) => `  ${JSON.stringify(key)}`)
            .join("\n")}`,
      );
    }
  });
});
