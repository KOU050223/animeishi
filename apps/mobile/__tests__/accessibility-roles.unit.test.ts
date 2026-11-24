import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 押せる要素がすべて accessibilityRole を持つことを固定する（issue #722）。
// oxlint には JSX の属性必須化を表せるルール（no-restricted-syntax 等）が無いため、
// app/ と components/ の .tsx を走査して検査する。
//
// CardPressable は内部で既定値 "button" を持ち呼び出し側で上書きできる
// （components/ui/card-pressable 参照）ため、呼び出し側の明示は不要。
// その実装内部の TouchableOpacity はこの走査の対象になるので、
// 既定値が消された場合もここで検出される。
const SCAN_DIRS = ["app", "components"];
const PRESSABLE_ELEMENTS = new Set([
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
]);

const rootDir = path.resolve(__dirname, "..");

function collectTsxFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTsxFiles(entryPath));
    } else if (
      entry.name.endsWith(".tsx") &&
      !entry.name.endsWith(".test.tsx")
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

// 開始タグ <Name ...> の文字列を返す。{...} 内の > やクォート内の > を
// 属性の終端と誤認しないよう、ブレース深さとクォートを追跡する。
function readOpeningTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    } else if (c === ">" && depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

function findElementsWithoutRole(
  filePath: string,
): { element: string; line: number }[] {
  const source = fs.readFileSync(filePath, "utf8");
  const found: { element: string; line: number }[] = [];
  const tagStart = /<([A-Za-z0-9_.]+)(?=[\s/>])/g;
  let match: RegExpExecArray | null;
  while ((match = tagStart.exec(source)) !== null) {
    const element = match[1];
    if (element === undefined || !PRESSABLE_ELEMENTS.has(element)) continue;
    const tag = readOpeningTag(source, match.index);
    // 別属性の文字列内に "accessibilityRole" が現れるだけでは合格にしないよう、
    // 属性構文（accessibilityRole=...）だけを数える
    if (!/\baccessibilityRole\s*=/.test(tag)) {
      found.push({
        element,
        line: source.slice(0, match.index).split("\n").length,
      });
    }
  }
  return found;
}

describe("押せる要素の accessibilityRole（issue #722）", () => {
  const files = SCAN_DIRS.flatMap((dir) =>
    collectTsxFiles(path.join(rootDir, dir)),
  );

  test("app/ と components/ の全押下要素がロールを持つ", () => {
    const missing = files.flatMap((file) =>
      findElementsWithoutRole(file).map(
        ({ element, line }) =>
          `${path.relative(rootDir, file)}:${line} <${element}>`,
      ),
    );
    expect(missing).toEqual([]);
  });

  // 呼び出し側はロール未指定の CardPressable を既定値 "button" 任せにできる。
  // 既定値が消えても属性の記述自体は残りうるため、既定値の存在を別途固定する。
  test.each([
    "components/ui/card-pressable/CardPressable.native.tsx",
    "components/ui/card-pressable/CardPressable.web.tsx",
  ])("CardPressable（%s）の既定ロールは button", (file) => {
    const source = fs.readFileSync(path.join(rootDir, file), "utf8");
    expect(source).toContain('accessibilityRole = "button"');
  });
});
