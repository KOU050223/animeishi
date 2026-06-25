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
  TID?: string; // しょぼいカレンダーのタイトル ID（安定した外部キー）
  Title?: string;
  TitleYomi?: string;
  TitleEN?: string;
  FirstYear?: string;
  FirstMonth?: string;
};

/** FirstMonth（1-12）から季節（spring 等）を導出する。 */
function monthToSeason(month: number | null): string | null {
  if (month === null) return null;
  if (month >= 3 && month <= 5) return "spring";
  if (month >= 6 && month <= 8) return "summer";
  if (month >= 9 && month <= 11) return "fall";
  return "winter";
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * しょぼいカレンダーから JSON でタイトル一覧を取得し、anime_titles 形式に正規化する。
 * 取得失敗時は例外を投げる（呼び出し側でログ・スキップ判断する）。
 */
export const fetchFromShobocal: AnimeSource = async () => {
  const url = `${SHOBOCAL_ENDPOINT}?Command=TitleLookup&Fields=TID,Title,TitleYomi,TitleEN,FirstYear,FirstMonth&JOIN=SubTitles`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(
      `しょぼいカレンダーからの取得に失敗しました (status=${res.status})`,
    );
  }

  const json = (await res.json()) as {
    Titles?: Record<string, ShobocalTitle>;
  };
  const titles = json.Titles ?? {};

  return Object.values(titles)
    .filter((t): t is ShobocalTitle & { Title: string } => Boolean(t.Title))
    .map((t) => {
      const month = toNumber(t.FirstMonth);
      return {
        sourceId: t.TID ? `shobocal:${t.TID}` : null,
        title: t.Title,
        titleReading: t.TitleYomi || null,
        titleEnglish: t.TitleEN || null,
        year: toNumber(t.FirstYear),
        season: monthToSeason(month),
        genres: null,
        thumbnailUrl: null,
      } satisfies AnimeSyncInput;
    });
};
