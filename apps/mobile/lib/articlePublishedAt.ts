// 特集記事の公開日（published_at）の画面表示用フォーマット。
// 記事詳細（app/article/[slug].tsx）と記事一覧（app/article/index.tsx）で
// 同じ表記を使う。

/**
 * 「2026年11月1日」のような公開日表記にする。解釈できない日時は空文字を返す。
 */
export function formatArticlePublishedAt(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}
