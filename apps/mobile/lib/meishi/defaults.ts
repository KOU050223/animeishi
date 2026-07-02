import type {
  AnimeCollageElement,
  AnimeCountBadgeElement,
  ImageElement,
  MeishiElement,
  MeishiElementType,
  QrElement,
  ShapeElement,
  TextElement,
  Transform,
} from "./types";

// 名刺のアスペクト比（幅/高）
export const MEISHI_ASPECT_RATIO = 1.6;

// エディタの最大表示幅。fontSize など px 系の値はこの幅を基準に保存する。
export const MEISHI_DESIGN_WIDTH = 560;

export const COLOR_PALETTE = [
  "#ffffff",
  "#f9fafb",
  "#f3f4f6",
  "#111827",
  "#1f2937",
  "#374151",
  "#ef4444",
  "#f97316",
  "#f59e0b",
  "#eab308",
  "#84cc16",
  "#22c55e",
  "#10b981",
  "#14b8a6",
  "#06b6d4",
  "#0ea5e9",
  "#3b82f6",
  "#6366f1",
  "#8b5cf6",
  "#a855f7",
  "#d946ef",
  "#ec4899",
  "#f43f5e",
  "#fecaca",
  "#fed7aa",
  "#fef08a",
  "#bbf7d0",
  "#bae6fd",
  "#c7d2fe",
  "#f5d0fe",
];

export const FONT_FAMILY_OPTIONS: {
  value: TextElement["fontFamily"];
  label: string;
}[] = [
  { value: "system", label: "システム" },
  { value: "notoSansJp", label: "Noto Sans JP" },
  { value: "notoSerifJp", label: "Noto Serif JP" },
  { value: "mPlusRounded", label: "M PLUS Rounded" },
  { value: "rocknRoll", label: "RocknRoll One" },
  { value: "shipporiMincho", label: "Shippori Mincho" },
];

export function newId(): string {
  // React Native / Web 双方で動く簡易ID。crypto があれば使う。
  const cryptoGlobal =
    typeof globalThis !== "undefined"
      ? (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
      : undefined;
  if (cryptoGlobal?.randomUUID) return cryptoGlobal.randomUUID();
  return `el_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const centered = (w: number, h: number): Transform => ({
  x: 0.5 - w / 2,
  y: 0.5 - h / 2,
  width: w,
  height: h,
  rotation: 0,
});

export function makeDefaultElement(type: MeishiElementType): MeishiElement {
  const id = newId();
  switch (type) {
    case "text": {
      const el: TextElement = {
        id,
        type: "text",
        transform: { x: 0.1, y: 0.1, width: 0.5, height: 0.12, rotation: 0 },
        text: "テキスト",
        source: "custom",
        fontSize: 18,
        fontFamily: "system",
        fontWeight: "bold",
        fontStyle: "normal",
        color: "#111827",
        align: "left",
      };
      return el;
    }
    case "image": {
      const el: ImageElement = {
        id,
        type: "image",
        transform: centered(0.3, 0.3 * MEISHI_ASPECT_RATIO),
        uri: "",
        source: "upload",
        shape: "rect",
        objectFit: "cover",
      };
      return el;
    }
    case "shape": {
      const el: ShapeElement = {
        id,
        type: "shape",
        transform: centered(0.4, 0.2),
        shape: "rectangle",
        fill: "#4f46e5",
        stroke: "#00000000",
        strokeWidth: 0,
        cornerRadius: 8,
      };
      return el;
    }
    case "qr": {
      const el: QrElement = {
        id,
        type: "qr",
        transform: {
          x: 0.72,
          y: 0.6,
          width: 0.22,
          height: 0.22 * MEISHI_ASPECT_RATIO,
          rotation: 0,
        },
        source: "profile",
        data: "",
        fgColor: "#111827",
        bgColor: "#ffffff",
      };
      return el;
    }
    case "animeCollage": {
      const el: AnimeCollageElement = {
        id,
        type: "animeCollage",
        transform: { x: 0.05, y: 0.55, width: 0.5, height: 0.3, rotation: 0 },
        cols: 3,
        rows: 2,
        sortBy: "recent",
        limit: 6,
        gap: 0.01,
      };
      return el;
    }
    case "animeCountBadge": {
      const el: AnimeCountBadgeElement = {
        id,
        type: "animeCountBadge",
        transform: { x: 0.6, y: 0.1, width: 0.3, height: 0.1, rotation: 0 },
        metric: "watched",
        prefix: "視聴 ",
        suffix: " 作品",
        fontSize: 16,
        fontWeight: "bold",
        fontFamily: "system",
        color: "#ffffff",
        bgColor: "#4f46e5",
      };
      return el;
    }
    default: {
      // 網羅性チェック: MeishiElementType に新しい種別を追加したらここでコンパイルエラーになる。
      const _exhaustive: never = type;
      throw new Error(`Unhandled element type: ${String(_exhaustive)}`);
    }
  }
}
