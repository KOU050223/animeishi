// dアニメストアのタイトル検索ページ URL（issue #353）。
// 作品ページの直リンクには dアニメ側の workId が必要だが、Annict 作品との
// 対応は保持していないためタイトル検索へ飛ばす。直リンク化は
// danimeWorkId の永続化や Annict の VOD 情報の利用で別途検討する。
const DANIME_WORK_SEARCH_URL =
  "https://animestore.docomo.ne.jp/animestore/sch_pc";

export function buildDanimeWorkSearchUrl(title: string): string {
  return `${DANIME_WORK_SEARCH_URL}?searchKey=${encodeURIComponent(title)}`;
}
