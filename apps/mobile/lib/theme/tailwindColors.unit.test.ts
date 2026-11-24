import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { colors } from "./colors";
import type { ThemeColors } from "./colors";

// colors.ts のセマンティックトークンを Tailwind の色（--color-*）として
// global.css に登録した対応表（issue #808）。`text-muted` のように
// トークン名で className を書ける。キーは colors.ts の全トークンを網羅する
// 必要がある（追加漏れは型エラーと下のテストで検出する）。
const TOKEN_TO_TW_COLOR = {
  text: "foreground",
  textSecondary: "secondary",
  textMuted: "muted",
  placeholder: "placeholder",
  background: "background",
  backgroundMuted: "background-muted",
  surface: "surface",
  surfaceMuted: "surface-muted",
  border: "border",
  borderMuted: "border-muted",
  primary: "primary",
  primaryText: "primary-text",
  primarySoft: "primary-soft",
  primaryBorder: "primary-border",
  onPrimary: "on-primary",
  danger: "danger",
  success: "success",
  successSoft: "success-soft",
  successText: "success-text",
  scrim: "scrim",
  canvasBackdrop: "canvas-backdrop",
  tierDropArea: "tier-drop-area",
  tierDropAreaActive: "tier-drop-area-active",
  tierCard: "tier-card",
  tierCardFallback: "tier-card-fallback",
  tierCardLabel: "tier-card-label",
} satisfies Record<keyof ThemeColors, string>;

const css = readFileSync(
  fileURLToPath(new URL("../../global.css", import.meta.url)),
  "utf8",
  // コメント内の @media / @theme という文字列をブロック解析から外す
).replaceAll(/\/\*[\s\S]*?\*\//g, "");

// openIndex（`{` の位置）から対応する `}` までの中身を返す。
function extractBlock(source: string, openIndex: number): string {
  let depth = 0;
  for (let i = openIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(openIndex + 1, i);
    }
  }
  throw new Error(`unbalanced braces at index ${openIndex}`);
}

function declarations(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/g)) {
    // rgba() 内の空白は意味を持たないため除去して比較する
    out[m[1]!] = m[2]!.replaceAll(/\s+/g, "");
  }
  return out;
}

// light 側は @theme ブロック、dark 側は
// @media (prefers-color-scheme: dark) 内の :root ブロックに書く。
const themeIndex = css.indexOf("@theme");
const lightDecls =
  themeIndex === -1
    ? {}
    : declarations(extractBlock(css, css.indexOf("{", themeIndex)));

const darkDecls: Record<string, string> = {};
for (const m of css.matchAll(/@media[^{]*prefers-color-scheme:\s*dark[^{]*/g)) {
  const mediaBody = extractBlock(css, m.index + m[0].length);
  for (const r of mediaBody.matchAll(/:root\s*\{/g)) {
    Object.assign(
      darkDecls,
      declarations(extractBlock(mediaBody, r.index + r[0].length - 1)),
    );
  }
}

describe("global.css の Tailwind 色トークン", () => {
  it.each(Object.entries(TOKEN_TO_TW_COLOR))(
    "colors.light.%s が --color-%s と一致する",
    (token, twColor) => {
      expect(lightDecls[twColor]).toBe(
        colors.light[token as keyof ThemeColors].replaceAll(/\s+/g, ""),
      );
    },
  );

  it.each(Object.entries(TOKEN_TO_TW_COLOR))(
    "colors.dark.%s が dark 側の --color-%s と一致する",
    (token, twColor) => {
      expect(darkDecls[twColor]).toBe(
        colors.dark[token as keyof ThemeColors].replaceAll(/\s+/g, ""),
      );
    },
  );

  it("@theme に対応表以外の --color-* を登録していない", () => {
    // colors.ts に無い色を勝手に増やすと colors.ts との食い違いが検出
    // できないため、登録色は対応表と一致させる。
    expect(Object.keys(lightDecls).sort()).toEqual(
      Object.values(TOKEN_TO_TW_COLOR).sort(),
    );
  });

  it("すべての登録色に dark 側の上書きがある", () => {
    expect(Object.keys(darkDecls).sort()).toEqual(
      Object.values(TOKEN_TO_TW_COLOR).sort(),
    );
  });
});
