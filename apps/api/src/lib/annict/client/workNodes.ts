import type { AnnictResult } from "./tada";

// 各クエリの image { ... } 選択と同一フィールドを持つ fragment。
// AnnictWorkImage 型の導出専用で、実行時には使わない。クエリ側は gql.tada が
// 静的リテラルを要求するためフィールドをインラインで持つ（テンプレート
// 展開だと型推論できない）。選択を変えたらクエリ側も合わせて変えること。
// クエリ内の image { 直後の改行・フィールドの列0始まりは、旧 WORK_IMAGE_FIELDS
// のテンプレート展開が生成していた送信文字列をバイト同一に保つための
// 意図的なレイアウト（GraphQL の空白は意味を持たない）。
const WORK_IMAGE_FRAGMENT = `fragment AnnictWorkImageFields on WorkImage {
  internalUrl(size: "300")
  recommendedImageUrl
  facebookOgImageUrl
  twitterBiggerAvatarUrl
  twitterAvatarUrl
  twitterNormalAvatarUrl
  twitterMiniAvatarUrl
}`;

export type AnnictWorkImage = AnnictResult<typeof WORK_IMAGE_FRAGMENT>;

export function resolveWorkImageUrl(
  image: AnnictWorkImage | null,
): string | null {
  return (
    image?.internalUrl ??
    image?.recommendedImageUrl ??
    image?.facebookOgImageUrl ??
    image?.twitterBiggerAvatarUrl ??
    image?.twitterAvatarUrl ??
    image?.twitterNormalAvatarUrl ??
    image?.twitterMiniAvatarUrl ??
    null
  );
}

/**
 * Annict GraphQL の Work.seasonName（enum: "WINTER" | "SPRING" | "SUMMER" |
 * "AUTUMN"。年は seasonYear に分かれる）を、annict_works.season_name と
 * searchWorks(seasons:) が使う "<年>-<シーズン>" 形式（例: "2026-autumn"）に
 * 揃える。今期判定・シーズン表示はすべてこの形式を前提に比較するため、
 * enum のまま保存すると一致しない。既に "<年>-<シーズン>"
 * 形式の値や年が不明な値は小文字化だけして返す。
 */
export function normalizeAnnictSeasonName(
  seasonName: string | null,
  seasonYear: number | null,
): string | null {
  if (!seasonName) return null;
  const lower = seasonName.toLowerCase();
  if (lower.includes("-") || seasonYear == null) return lower;
  return `${seasonYear}-${lower}`;
}

/** 整形済みの 1 作品分のライブラリエントリ（D1 キャッシュへの書き込み単位）。 */
export type AnnictLibraryEntry = {
  annictWorkId: number;
  nodeId: string;
  state: string | null;
  title: string;
  titleKana: string | null;
  titleEn: string | null;
  seasonName: string | null;
  seasonYear: number | null;
  imageUrl: string | null;
  // Annict Work.malAnimeId は文字列。数値変換に失敗する値は捨てて null にする。
  malAnimeId: number | null;
  // Annict Work.media（"TV" | "MOVIE" | "OVA" | "WEB" | "OTHER"）。
  // 取得しないクエリ経路では undefined のまま。メディア種別絞り込み用（issue #346）。
  media?: string | null;
  // Annict Work.watchersCount（作品の人気指標）。取得しないクエリ経路では
  // undefined のまま（その場合はキャッシュの既存値を消さない）。
  watchersCount?: number | null;
};

// Annict の malAnimeId は文字列だが空文字や非数値が混ざる可能性があるため
// 安全にパースする。呼び出し側の分岐を減らすためここで正規化する。
export function parseMalAnimeId(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}
