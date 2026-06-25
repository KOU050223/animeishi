import { XMLParser } from "fast-xml-parser";
import type { AnimeSyncInput } from "@/repository/animeSyncRepo";

/**
 * アニメデータの取得元（しょぼいカレンダー等）を抽象化したインターフェース。
 * バッチ本体は具体的な取得先を知らず、この関数を通じて正規化済みデータを受け取る。
 * テストではモックを注入し、本番では fetchFromShobocal を使う。
 */
export type AnimeSource = (options?: {
  /** 季節同期で対象シーズンを絞り込む場合に指定する（例: { year: 2026, season: "spring" }） */
  year?: number;
  season?: string;
}) => Promise<AnimeSyncInput[]>;

/** しょぼいカレンダー DB の TitleLookup API のエンドポイント。 */
const SHOBOCAL_ENDPOINT = "https://cal.syoboi.jp/db.php";

type ShobocalTitle = {
  TID?: string | number; // しょぼいカレンダーのタイトル ID（安定した外部キー）
  Title?: string;
  TitleYomi?: string;
  TitleEN?: string;
  FirstYear?: string | number;
  FirstMonth?: string | number;
};

/**
 * TitleLookup の XML レスポンス。
 * db.php は Accept ヘッダに関わらず XML のみを返すため、XMLParser でパースする。
 * TitleItem は 1 件のときオブジェクト、複数件のとき配列になる（fast-xml-parser の仕様）。
 */
type TitleLookupResponse = {
  TitleLookupResponse?: {
    TitleItems?: {
      TitleItem?: ShobocalTitle | ShobocalTitle[];
    };
  };
};

// TID 等を文字列のまま受け取り（parseTagValue: false）、後段の toNumber で正規化する。
const xmlParser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

/** FirstMonth（1-12）から季節（spring 等）を導出する。 */
function monthToSeason(month: number | null): string | null {
  if (month === null) return null;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "fall";
  return "winter";
}

function toNumber(value: string | number | undefined): number | null {
  if (value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

/** XML の任意フィールドを文字列に正規化する（空要素は空文字、数値は文字列化）。 */
function toStr(value: string | number | undefined): string {
  if (value === undefined) return "";
  return String(value);
}

/**
 * しょぼいカレンダーから XML でタイトル一覧を取得し、anime_titles 形式に正規化する。
 * 取得失敗時は例外を投げる（呼び出し側でログ・スキップ判断する）。
 *
 * db.php の TitleLookup は `TID=*` を指定すると全タイトルを返す。
 * このパラメータが無いと「TID が指定されていません」(400) になるため必須。
 * また db.php は Accept ヘッダに関わらず XML のみを返すため、XMLParser でパースする。
 *
 * `options.year` / `options.season` が指定された場合は、その条件に一致する作品のみに
 * 絞り込む（season-sync が現在シーズンのみを更新するため）。
 * しょぼいカレンダーの TitleLookup には季節での絞り込みパラメータが無いため、
 * 取得後にクライアント側でフィルタする。
 */
export const fetchFromShobocal: AnimeSource = async (options) => {
  const url = `${SHOBOCAL_ENDPOINT}?Command=TitleLookup&TID=*&Fields=TID,Title,TitleYomi,TitleEN,FirstYear,FirstMonth`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `しょぼいカレンダーからの取得に失敗しました (status=${res.status})`,
    );
  }

  const xml = await res.text();
  const parsed = xmlParser.parse(xml) as TitleLookupResponse;
  const item = parsed.TitleLookupResponse?.TitleItems?.TitleItem;
  // TitleItem は 0 件→undefined / 1 件→オブジェクト / 複数→配列。配列に正規化する。
  const titles: ShobocalTitle[] =
    item === undefined ? [] : Array.isArray(item) ? item : [item];

  const normalized = titles
    .filter((t): t is ShobocalTitle & { Title: string } => Boolean(t.Title))
    .map((t) => {
      const month = toNumber(t.FirstMonth);
      const tid = toStr(t.TID);
      return {
        sourceId: tid ? `shobocal:${tid}` : null,
        title: t.Title,
        titleReading: toStr(t.TitleYomi) || null,
        titleEnglish: toStr(t.TitleEN) || null,
        year: toNumber(t.FirstYear),
        season: monthToSeason(month),
        genres: null,
        thumbnailUrl: null,
      } satisfies AnimeSyncInput;
    });

  // year / season が指定されていれば対象シーズンに絞り込む。
  if (options?.year === undefined && options?.season === undefined) {
    return normalized;
  }
  return normalized.filter((t) => {
    if (options.year !== undefined && t.year !== options.year) return false;
    if (options.season !== undefined && t.season !== options.season)
      return false;
    return true;
  });
};
