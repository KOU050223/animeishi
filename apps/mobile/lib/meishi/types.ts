// 名刺エディタ（簡易Figma風）のデータモデル
// 詳細は docs/06_meishi-editor-design.md を参照。

export type Transform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type FontWeight = "normal" | "bold" | "black";
export type FontStyle = "normal" | "italic";
export type FontFamily =
  | "system"
  | "notoSansJp"
  | "notoSerifJp"
  | "mPlusRounded"
  | "rocknRoll"
  | "shipporiMincho";

export type BackgroundStyle =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle?: number }
  | {
      kind: "pattern";
      base: string;
      accent: string;
      pattern: "dots" | "stripes" | "grid";
    };

export type TextAlign = "left" | "center" | "right";
export type ImageShape = "rect" | "circle" | "rounded";
export type ImageObjectFit = "cover" | "contain";
export type ShapeKind = "rectangle" | "circle";

export type TextSource = "custom" | "username" | "bio" | "favoriteQuote";
export type ImageSource = "avatar" | "upload" | "anime";
export type QrSource = "profile" | "custom";
export type CountMetric = "watched" | "favorites";
export type CollageSort = "recent" | "popular";

export type TextElement = {
  id: string;
  type: "text";
  transform: Transform;
  text: string;
  source: TextSource;
  fontSize: number;
  fontFamily: FontFamily;
  fontWeight: FontWeight;
  fontStyle: FontStyle;
  color: string;
  align: TextAlign;
};

export type ImageElement = {
  id: string;
  type: "image";
  transform: Transform;
  uri: string;
  source: ImageSource;
  shape: ImageShape;
  objectFit: ImageObjectFit;
};

export type ShapeElement = {
  id: string;
  type: "shape";
  transform: Transform;
  shape: ShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
};

export type QrElement = {
  id: string;
  type: "qr";
  transform: Transform;
  source: QrSource;
  data: string;
  fgColor: string;
  bgColor: string;
};

export type AnimeCollageElement = {
  id: string;
  type: "animeCollage";
  transform: Transform;
  cols: number;
  rows: number;
  sortBy: CollageSort;
  limit: number;
  gap: number;
};

export type AnimeCountBadgeElement = {
  id: string;
  type: "animeCountBadge";
  transform: Transform;
  metric: CountMetric;
  prefix: string;
  suffix: string;
  fontSize: number;
  fontWeight: FontWeight;
  fontFamily: FontFamily;
  color: string;
  bgColor: string;
};

export type MeishiElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | QrElement
  | AnimeCollageElement
  | AnimeCountBadgeElement;

export type MeishiElementType = MeishiElement["type"];

export type MeishiDocument = {
  version: 1;
  canvas: {
    aspectRatio: number;
    background: BackgroundStyle;
  };
  elements: MeishiElement[];
};

// レンダラー側で source バインドや実データを解決するためのコンテキスト
export type MeishiRenderContext = {
  profile: {
    username?: string | null;
    bio?: string | null;
    favoriteQuote?: string | null;
    profileImageUrl?: string | null;
    profileUrl?: string | null;
  };
  animeCollageImages?: string[];
  watchedCount?: number;
  favoritesCount?: number;
};
