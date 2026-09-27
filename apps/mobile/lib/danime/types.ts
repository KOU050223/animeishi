// dアニメストア インポートで使う共通型。

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
  /** コンプリート作品（mpa_cmp_pc）。→ WATCHED に登録する対象。 */
  completed: DanimeExtractedWork[];
  /** 視聴履歴（mpa_hst_pc）。completed に無い作品は WATCHING 対象。 */
  history: DanimeExtractedWork[];
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
