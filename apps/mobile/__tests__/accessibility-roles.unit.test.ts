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

function stripStringLiterals(source: string): string {
  return source.replace(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g,
    "",
  );
}

// JSX 属性の object 式（foo={{ ... }}）の中身を返す。
// 属性値は開始タグ内で入れ子のブレースを持つため、正規表現ではなく深度を数える。
function readObjectAttribute(
  attributesOnly: string,
  name: string,
): string | undefined {
  const attribute = new RegExp(`\\b${name}\\s*=\\s*`).exec(attributesOnly);
  if (!attribute) return undefined;
  const start = attribute.index + attribute[0].length;
  if (attributesOnly[start] !== "{") return undefined;
  let depth = 0;
  for (let i = start; i < attributesOnly.length; i++) {
    if (attributesOnly[i] === "{") depth++;
    if (attributesOnly[i] === "}") {
      depth--;
      if (depth === 0) return attributesOnly.slice(start + 1, i);
    }
  }
  return undefined;
}

// 子を持たない（自己完結タグの）押下要素を返す。子テキストやアイコンで
// 内容を示せないため、シートの背景（スクリム）のような名無しの押下領域は
// accessibilityLabel が無いとスクリーンリーダーで意味を伝えられない
// （issue #809）。
function findLeafElementsWithoutLabel(
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
    // 子を持つ要素（</X> で閉じるもの）はラベル必須の対象外
    if (!/\/\s*>$/.test(tag)) continue;
    // 別属性の値の中に "accessibilityLabel=" が含まれても
    // 合格にしないよう、文字列リテラルを除いてから属性名を調べる
    const attributesOnly = stripStringLiterals(tag);
    if (!/\baccessibilityLabel\s*=/.test(attributesOnly)) {
      found.push({
        element,
        line: source.slice(0, match.index).split("\n").length,
      });
    }
  }
  return found;
}

type SelectedStateElement = {
  element: string;
  line: number;
  attributesOnly: string;
};

// accessibilityState.selected を持つ開始タグを集める。選択式ボタンは
// 見た目の枠や色だけでなく、名前と選択状態を支援技術へ伝える必要がある。
function findSelectedStateElements(filePath: string): SelectedStateElement[] {
  const source = fs.readFileSync(filePath, "utf8");
  const found: SelectedStateElement[] = [];
  const tagStart = /<([A-Za-z0-9_.]+)(?=[\s/>])/g;
  let match: RegExpExecArray | null;
  while ((match = tagStart.exec(source)) !== null) {
    const element = match[1];
    if (element === undefined || !PRESSABLE_ELEMENTS.has(element)) continue;
    const tag = readOpeningTag(source, match.index);
    const attributesOnly = stripStringLiterals(tag);
    const objectExpression = readObjectAttribute(
      attributesOnly,
      "accessibilityState",
    );
    // checked: selected のように値の変数名が selected なだけのものは
    // 選択状態ではないため、オブジェクトのキーにある selected だけを見る。
    const trimmedObject = objectExpression?.trim();
    const state =
      trimmedObject?.startsWith("{") && trimmedObject.endsWith("}")
        ? trimmedObject.slice(1, -1)
        : undefined;
    const hasSelectedKey =
      state !== undefined && /(?:^|,)\s*selected\s*(?::|,|$)/.test(state);
    if (!hasSelectedKey) continue;
    found.push({
      element,
      line: source.slice(0, match.index).split("\n").length,
      attributesOnly,
    });
  }
  return found;
}

function hasSelectionAccessibilitySpread(attributesOnly: string): boolean {
  return /\{\s*\.\.\.\s*selectionAccessibilityProps\s*\(/.test(attributesOnly);
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

  test("子を持たない押下要素（シートの背景等）は accessibilityLabel を持つ", () => {
    const missing = files.flatMap((file) =>
      findLeafElementsWithoutLabel(file).map(
        ({ element, line }) =>
          `${path.relative(rootDir, file)}:${line} <${element}>`,
      ),
    );
    expect(missing).toEqual([]);
  });

  test("選択状態を持つ押下要素は accessibilityLabel を持つ", () => {
    const missing = files.flatMap((file) =>
      findSelectedStateElements(file)
        .filter(
          ({ attributesOnly }) =>
            !/\baccessibilityLabel\s*=/.test(attributesOnly),
        )
        .map(
          ({ element, line }) =>
            `${path.relative(rootDir, file)}:${line} <${element}>`,
        ),
    );
    expect(missing).toEqual([]);
  });

  test("選択状態の検査は onPress 内の呼び出しではなく spread だけを合格にする", () => {
    expect(
      hasSelectionAccessibilitySpread(
        "<Pressable accessibilityState={{ selected: isSelected }} {...selectionAccessibilityProps(isSelected)}>",
      ),
    ).toBe(true);
    expect(
      hasSelectionAccessibilitySpread(
        "<Pressable accessibilityState={{ selected: isSelected }} onPress={() => selectionAccessibilityProps(isSelected)}>",
      ),
    ).toBe(false);
  });

  test("選択状態を持つ押下要素は Web に選択状態を出す", () => {
    const missing = files.flatMap((file) =>
      findSelectedStateElements(file)
        .filter(
          ({ attributesOnly }) =>
            !hasSelectionAccessibilitySpread(attributesOnly),
        )
        .map(
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
