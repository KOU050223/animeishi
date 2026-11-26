import type { TranslationKey } from "@/lib/i18n/keys";
import type {
  AchievementBadgeElement,
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

/**
 * 名刺エディタの色見本。見た目の色だけではスクリーンリーダーで
 * 区別できないため、翻訳可能な色名を併せて持つ（issue #809）。
 */
export const COLOR_PALETTE: { value: string; name: TranslationKey }[] = [
  { value: "#ffffff", name: "白" },
  { value: "#f9fafb", name: "オフホワイト" },
  { value: "#f3f4f6", name: "淡いグレー" },
  { value: "#111827", name: "黒" },
  { value: "#1f2937", name: "濃いグレー" },
  { value: "#374151", name: "グレー" },
  { value: "#ef4444", name: "赤" },
  { value: "#f97316", name: "オレンジ" },
  { value: "#f59e0b", name: "アンバー" },
  { value: "#eab308", name: "黄色" },
  { value: "#84cc16", name: "黄緑" },
  { value: "#22c55e", name: "緑" },
  { value: "#10b981", name: "エメラルド" },
  { value: "#14b8a6", name: "青緑" },
  { value: "#06b6d4", name: "シアン" },
  { value: "#0ea5e9", name: "スカイブルー" },
  { value: "#3b82f6", name: "青" },
  { value: "#6366f1", name: "インディゴ" },
  { value: "#8b5cf6", name: "青紫" },
  { value: "#a855f7", name: "紫" },
  { value: "#d946ef", name: "フクシア" },
  { value: "#ec4899", name: "ピンク" },
  { value: "#f43f5e", name: "ローズ" },
  { value: "#fecaca", name: "淡い赤" },
  { value: "#fed7aa", name: "淡いオレンジ" },
  { value: "#fef08a", name: "淡い黄色" },
  { value: "#bbf7d0", name: "淡い緑" },
  { value: "#bae6fd", name: "淡い水色" },
  { value: "#c7d2fe", name: "淡いインディゴ" },
  { value: "#f5d0fe", name: "淡い赤紫" },
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
    case "achievementBadge": {
      const el: AchievementBadgeElement = {
        id,
        type: "achievementBadge",
        transform: { x: 0.55, y: 0.1, width: 0.4, height: 0.1, rotation: 0 },
        kind: "watch_count",
        fontSize: 16,
        fontWeight: "bold",
        fontFamily: "system",
        color: "#ffffff",
        bgColor: "#d97706",
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
