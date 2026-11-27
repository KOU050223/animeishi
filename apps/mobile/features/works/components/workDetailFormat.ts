import type { TFunction } from "i18next";
import type { TranslationKey } from "@/lib/i18n/keys";
import type { AnimeTitle } from "@/features/works/useAnimeList";

// 作品詳細シートと作品ページ（app/work/[id]）で共有する、表示以外の値の組み立て。
// WorkDetailInfo.tsx をコンポーネントだけの export に保ち Fast Refresh を効かせるため分けている。

/**
 * 詳細シート・作品ページのヘッダーが必要とする作品メタ。一覧カードの
 * 検索結果（AnimeTitle）に加えて AI おすすめ（RecommendedWork）のような
 * 別経路の作品でも開けるよう、使うフィールドだけを要求する。残りの
 * 詳細情報は useWorkDetail が annictWorkId で取り直す。
 */
export type WorkDetailSheetTarget = Pick<
  AnimeTitle,
  | "annictWorkId"
  | "title"
  | "titleEn"
  | "seasonYear"
  | "seasonName"
  | "hostedImageUrl"
>;

// Annict Work.media（TV / OVA / MOVIE / WEB / OTHER）の表示ラベル。
// TV / OVA / Web はそのまま出すため日本語キーに含めない。値は表示時に
// TranslationKey として t() に通す（未知キーはそのまま表示される）。
const MEDIA_LABELS: Record<string, string> = {
  TV: "TV",
  OVA: "OVA",
  MOVIE: "映画",
  WEB: "Web",
  OTHER: "その他",
};

/** Annict Work.media を表示ラベルにする。未取得なら null。 */
export function workMediaLabel(
  media: string | null | undefined,
  t: TFunction,
): string | null {
  if (!media) return null;
  return MEDIA_LABELS[media] ? t(MEDIA_LABELS[media] as TranslationKey) : media;
}

/**
 * 放送シーズンのチップから移る、そのシーズン / 年通年の作品一覧
 * （ライブラリタブのアニメ一覧の絞り込み。issue #535）への遷移先。
 */
export function seasonListHref(seasonParam: string) {
  return {
    pathname: "/(tabs)/library",
    params: {
      section: "anime",
      season: seasonParam,
      // 同じ season への再遷移でも一覧をリマウントさせるマーカー。
      // URL が変わらないと key が変わらず、手で変えた検索語・絞り込みが
      // 残ったままになる（issue #535 の完了条件）。
      nav: String(Date.now()),
    },
  } as const;
}

/** Annict の作品ページ URL。 */
export function annictWorkUrl(annictWorkId: number) {
  return `https://annict.com/works/${annictWorkId}`;
}
