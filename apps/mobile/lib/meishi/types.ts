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

// コラージュの画像をどのリストから取るか。undefined は「自動」
// （視聴履歴 → 空ならお気に入り、の従来フォールバック）を表す。
export type CollageListSource = "watchHistory" | "favorites";
// 視聴履歴リストを Annict の視聴ステータスで絞る。undefined/"all" は全ステータス。
export type CollageStateFilter =
  | "all"
  | "WATCHING"
  | "WATCHED"
  | "ON_HOLD"
  | "STOP_WATCHING"
  | "WANNA_WATCH";

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
  // issue #96 で追加。未設定の既存ドキュメントは「自動・全ステータス」として扱う。
  listSource?: CollageListSource;
  state?: CollageStateFilter;
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

// animeCollage が参照できるリスト別の画像 URL 集合（issue #96）。
export type AnimeCollageLists = {
  watchHistory: string[];
  favorites: string[];
  byState: Partial<Record<Exclude<CollageStateFilter, "all">, string[]>>;
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
  // リスト別の画像。古い呼び出し側が animeCollageImages だけ渡すケースに備え optional。
  animeLists?: AnimeCollageLists;
  watchedCount?: number;
  favoritesCount?: number;
};
