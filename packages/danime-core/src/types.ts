// dアニメストア インポートで使う共通型。

// 抽出ペイロードのスキーマバージョン。WebView postMessage /
// ブックマークレット / 将来の拡張 content script と消費側で契約が
// ずれないよう versioned contract にする。ペイロードの形を変えるときは
// この値を上げる（消費側は未知のバージョンを拒否する）。
export const DANIME_EXTRACT_SCHEMA_VERSION = 1;

/** 抽出結果の 1 作品。workId が取れないカードは title を疑似キーにする。 */
export type DanimeExtractedWork = {
  /** dアニメ側の workId。カードから取れない場合は `title:<タイトル>` の疑似キー。 */
  workId: string;
  title: string;
  /** 履歴カードに含まれる話数リンク（partId）。作品集約の根拠として保持する。 */
  partIds: string[];
};

/** 抽出スクリプトが返すペイロード。 */
export type DanimeExtractedLists = {
  schemaVersion: typeof DANIME_EXTRACT_SCHEMA_VERSION;
  /** コンプリート作品（mpa_cmp_pc）。→ WATCHED に登録する対象。 */
  completed: DanimeExtractedWork[];
  /** 視聴履歴（mpa_hst_pc）。completed に無い作品は WATCHING 対象。 */
  history: DanimeExtractedWork[];
  /**
   * 抽出フェーズの所要時間（ms）。所要時間の可視化用。
   * 手動貼り付けや古いスクリプトのペイロードには含まれないため任意。
   */
  extractElapsedMs?: number;
};

// WebView postMessage / ブックマークレットで運ばれるメッセージ。
export type DanimeExtractMessage =
  | { type: "animeishi:danime-extract"; payload: DanimeExtractedLists }
  | { type: "animeishi:danime-extract-error"; message: string };

// POST /me/import/danime/match の results 要素と対応するクライアント側の型。
// （API 側 DanimeMatchResult と形を合わせる。hono client の InferResponseType 経由でも
//   取れるが、選択状態を持つ UI モデルとして別途持つ。）
export type DanimeMatchItem = {
  danimeWorkId: string;
  title: string;
  targetState: "WATCHED" | "WATCHING";
  status: "exact" | "candidates" | "none";
  work: DanimeAnnictWork | null;
  candidates: DanimeAnnictWork[];
};

/**
 * 照合候補として扱う Annict 作品の最小メタ。
 * Annict 取得経路（animeishi API の GraphQL クライアント、将来のスタンドアロン版
 * の直接 GraphQL 等）に依らず、照合に必要なフィールドだけを契約にする。
 */
export type DanimeAnnictWork = {
  annictWorkId: number;
  nodeId: string;
  title: string;
  titleKana: string | null;
  titleEn: string | null;
  seasonName: string | null;
  seasonYear: number | null;
  imageUrl: string | null;
  malAnimeId: number | null;
};
