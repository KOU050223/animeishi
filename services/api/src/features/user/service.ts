import { escapeHtml } from "@/lib/html";
import type { UserWatchSummary } from "./repository";

/**
 * スナップショット時刻の表示用日付（YYYY/M/D）。
 * OGP HTML は Worker 上で生成するため TZ は実行環境に依存しない。
 * 利用者のほぼ全てが JST 圏のため UTC+9 固定で組み立てる。
 */
function formatSnapshotDate(d: Date): string {
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}/${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
}

/**
 * og:description 等に載せる視聴サマリの 1 行テキスト
 * （例: "視聴済み120作品・見たい5作品・お気に入り8作品（2026/10/13時点）"）。
 * 0 件だけ・未同期なら空文字を返す（呼び出し側でサマリ自体を省略する）。
 * SNS カードでは description が主な露出面のため、スナップショットの時点も
 * ここに含める（本文の注記だけではカード上で読めない）。
 */
function buildWatchSummaryText(summary: UserWatchSummary): string {
  const parts = [
    summary.watchedCount > 0 ? `視聴済み${summary.watchedCount}作品` : "",
    summary.watchingCount > 0 ? `視聴中${summary.watchingCount}作品` : "",
    summary.wannaWatchCount > 0 ? `見たい${summary.wannaWatchCount}作品` : "",
    summary.favoriteCount > 0 ? `お気に入り${summary.favoriteCount}作品` : "",
  ].filter(Boolean);
  if (parts.length === 0) return "";
  const synced = summary.syncedAt
    ? `（${formatSnapshotDate(summary.syncedAt)}時点）`
    : "";
  return `${parts.join("・")}${synced}`;
}

/**
 * 「Web で見る」導線の URL を組み立てる。
 * PUBLIC_WEB_URL があれば `${base}/user/<id>`、なければこのページ自身の
 * オリジン + `/user/<id>`（API が返すこの HTML が実質 Web 版なので
 * 自己参照で問題ない）にフォールバックする。
 */
export function buildWebProfileUrl(
  publicWebUrl: string | undefined,
  requestUrl: string,
  userId: string,
): string {
  const base = (publicWebUrl ?? new URL(requestUrl).origin).replace(/\/+$/, "");
  return `${base}/user/${encodeURIComponent(userId)}`;
}

export function buildOgpHtml(
  profile: {
    id: string;
    username: string;
    bio: string | null;
    favoriteQuote: string | null;
    profileImageUrl: string | null;
  },
  genres: string[],
  watchSummary: UserWatchSummary,
  webProfileUrl: string,
): string {
  const title = `${escapeHtml(profile.username)} - Animeishi`;
  // 名刺としての訴求を優先し、視聴サマリを description 先頭に置く
  // （SNS カードで bio より先に表示されるため）。
  const summaryText = buildWatchSummaryText(watchSummary);
  const baseDescription = profile.bio
    ? escapeHtml(profile.bio)
    : `${escapeHtml(profile.username)} のアニメプロフィール`;
  const description = summaryText
    ? `${summaryText} / ${baseDescription}`
    : baseDescription;
  const image = profile.profileImageUrl
    ? escapeHtml(profile.profileImageUrl)
    : "";
  const genreText =
    genres.length > 0 ? escapeHtml(genres.join("・")) : "未設定";
  const quoteText = profile.favoriteQuote
    ? escapeHtml(profile.favoriteQuote)
    : "";

  // 0 件の項目は名刺で見せても訴求にならないため、値のある項目だけ並べる。
  const statItems = (
    [
      ["視聴済み", watchSummary.watchedCount],
      ["視聴中", watchSummary.watchingCount],
      ["見たい", watchSummary.wannaWatchCount],
      ["お気に入り", watchSummary.favoriteCount],
    ] as const
  ).filter(([, n]) => n > 0);
  const statsHtml =
    statItems.length > 0
      ? `<div class="stats">${statItems
          .map(
            ([label, n]) =>
              `<div class="stat"><span class="stat-num">${n}</span><span class="stat-label">${label}</span></div>`,
          )
          .join("")}</div>`
      : "";
  const favoriteTitlesHtml =
    watchSummary.favoriteTitles.length > 0
      ? `<p class="favorite-works">お気に入り: ${watchSummary.favoriteTitles
          .map((t) => escapeHtml(t))
          .join(" / ")}</p>`
      : "";
  // D1 キャッシュは本人が一覧を開いた時点のスナップショットで、ここからは
  // 更新タイミングを制御できない。表示時点のデータではないことを明記する。
  // サマリの表示物が何も無いとき（集計対象外の状態だけが残っている等）は
  // 注記だけが浮くため出さない。
  const snapshotNoteHtml =
    watchSummary.syncedAt && (statItems.length > 0 || favoriteTitlesHtml !== "")
      ? `<p class="snapshot-note">視聴データは ${formatSnapshotDate(watchSummary.syncedAt)} 時点のスナップショットです</p>`
      : "";

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:type" content="profile" />
  ${image ? `<meta property="og:image" content="${image}" />` : ""}
  <meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  ${image ? `<meta name="twitter:image" content="${image}" />` : ""}
  <style>
    body { font-family: sans-serif; max-width: 600px; margin: 40px auto; padding: 0 16px; color: #1a1a1a; }
    .avatar { width: 80px; height: 80px; border-radius: 50%; object-fit: cover; }
    .username { font-size: 1.5rem; font-weight: bold; margin: 16px 0 4px; }
    .bio { color: #555; margin: 8px 0; }
    .quote { border-left: 3px solid #e0a; padding-left: 12px; color: #777; margin: 12px 0; font-style: italic; }
    .stats { display: flex; gap: 16px; margin-top: 16px; }
    .stat { text-align: center; }
    .stat-num { display: block; font-size: 1.25rem; font-weight: bold; }
    .stat-label { font-size: 0.75rem; color: #777; }
    .favorite-works { margin-top: 12px; font-size: 0.9rem; color: #555; }
    .snapshot-note { margin-top: 16px; font-size: 0.75rem; color: #999; }
    .genres { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
    .genre { background: #f0f0f0; border-radius: 12px; padding: 2px 10px; font-size: 0.85rem; }
    .app-link { display: inline-block; margin-top: 24px; padding: 10px 20px; background: #7c3aed; color: #fff; border-radius: 8px; text-decoration: none; }
    .web-link { margin-top: 12px; font-size: 0.9rem; color: #666; }
    .web-link a { color: #7c3aed; }
  </style>
</head>
<body>
  ${image ? `<img class="avatar" src="${image}" alt="${escapeHtml(profile.username)}" />` : ""}
  <div class="username">${escapeHtml(profile.username)}</div>
  ${profile.bio ? `<p class="bio">${escapeHtml(profile.bio)}</p>` : ""}
  ${quoteText ? `<blockquote class="quote">${quoteText}</blockquote>` : ""}
  ${statsHtml}
  ${favoriteTitlesHtml}
  ${snapshotNoteHtml}
  <div class="genres">
    ${genres.map((g) => `<span class="genre">${escapeHtml(g)}</span>`).join("")}
    ${genres.length === 0 ? `<span class="genre">${genreText}</span>` : ""}
  </div>
  <a class="app-link" href="animeishi://user/${escapeHtml(profile.id)}">アプリで見る</a>
  <p class="web-link">アプリをお持ちでない方は <a href="${escapeHtml(webProfileUrl)}">Web 版で見る</a></p>
</body>
</html>`;
}

export function notFoundHtml(): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <title>ユーザーが見つかりません - Animeishi</title>
</head>
<body>
  <h1>ユーザーが見つかりません</h1>
  <p>このプロフィールは存在しないか、非公開に設定されています。</p>
</body>
</html>`;
}
