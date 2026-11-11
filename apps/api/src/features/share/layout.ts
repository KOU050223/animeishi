import { escapeHtml } from "@/lib/html";

/**
 * 共有ページ（/share/*）の HTML 骨格と共通スタイル（issue #518）。
 * 各ページはヘッダ（ヒーロー）と本文だけを組み立て、配色トークン・
 * ダーク追従・フッタはここに揃える。JS は使わない（AI・クローラが
 * 素の HTML として読めることを優先する。issue #236）。
 */

/**
 * アプリの lib/theme/colors.ts と同じ値の配色トークン。
 * ダークは閲覧者のシステムスキームに追従する（アプリと同じ slate 系）。
 */
const BASE_CSS = `
    :root {
      --bg: #f8fafc; --surface: #ffffff; --surface-muted: #f1f5f9;
      --border: #e2e8f0; --text: #0f172a; --text-secondary: #475569;
      --text-muted: #64748b; --primary: #4f46e5; --primary-text: #4f46e5;
      --primary-soft: #eef2ff; --primary-border: #a5b4fc;
      --poster-fallback: #e2e8f0;
      --shadow: 0 1px 2px rgba(15, 23, 42, 0.06), 0 4px 16px rgba(15, 23, 42, 0.06);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #020617; --surface: #0f172a; --surface-muted: #1e293b;
        --border: #1e293b; --text: #f1f5f9; --text-secondary: #cbd5e1;
        --text-muted: #94a3b8; --primary: #4f46e5; --primary-text: #818cf8;
        --primary-soft: #312e81; --primary-border: #4338ca;
        --poster-fallback: #334155;
        --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); line-height: 1.5;
      font-family: system-ui, -apple-system, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
      -webkit-font-smoothing: antialiased; }
    .container { width: 100%; max-width: var(--page-width, 760px); margin: 0 auto; padding: 0 16px; }
    .hero { background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; padding: 20px 0 28px; }
    .brand { margin: 0 0 20px; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.12em; opacity: 0.9; }
    .kind { display: inline-block; margin: 0 0 8px; padding: 2px 10px; border-radius: 999px;
      background: rgba(255, 255, 255, 0.18); font-size: 0.75rem; font-weight: 600; }
    h1 { margin: 0; font-size: 1.6rem; line-height: 1.3; overflow-wrap: anywhere; }
    .owner { margin: 6px 0 0; color: rgba(255, 255, 255, 0.85); font-size: 0.9rem; }
    .description { margin: 12px 0 0; color: rgba(255, 255, 255, 0.95); white-space: pre-wrap; overflow-wrap: anywhere; }
    .stats { display: flex; flex-wrap: wrap; gap: 8px; margin: 16px 0 0; padding: 0; list-style: none; }
    .stats li { padding: 4px 12px; border-radius: 10px; background: rgba(255, 255, 255, 0.14); font-size: 0.8rem; }
    .stats strong { font-size: 1rem; margin-right: 2px; }
    main.container { padding-top: 24px; padding-bottom: 8px; }
    .empty { padding: 32px 16px; text-align: center; color: var(--text-muted); background: var(--surface);
      border: 1px dashed var(--border); border-radius: 14px; }
    .work-image { display: block; object-fit: cover; background: var(--poster-fallback); }
    .site-footer.container { padding-top: 24px; padding-bottom: 40px; text-align: center; color: var(--text-muted); font-size: 0.8rem; }
    .site-footer strong { color: var(--primary-text); }
`;

export type SharePageInput = {
  /** <title> / og:title。HTML エスケープ済みであること。 */
  title: string;
  /** meta description / og:description。HTML エスケープ済みであること。 */
  metaDescription?: string | undefined;
  /** og:url / canonical。未エスケープの URL（ここでエスケープする）。 */
  canonicalUrl?: string | undefined;
  /** og:image。未エスケープの URL。 */
  ogImage?: string | undefined;
  /** ヒーロー上部のページ種別ラベル（例: 「Tier 表」）。プレーンテキスト。 */
  kind: string;
  /** 見出し。HTML エスケープ済みであること。 */
  heading: string;
  /** 所有者行。HTML エスケープ済みであること。 */
  ownerLine?: string | undefined;
  /** 説明文。未エスケープのプレーンテキスト（ここでエスケープする）。 */
  description?: string | null | undefined;
  /** ヒーロー下部の件数表示など。HTML。 */
  statsHtml?: string | undefined;
  /** main の中身。HTML。 */
  bodyHtml: string;
  /** ページ固有のスタイル。 */
  pageCss?: string | undefined;
  /** 本文の最大幅。tier 表のように横に広い盤面は wide にする。 */
  width?: "narrow" | "wide" | undefined;
};

export function renderSharePage(input: SharePageInput): string {
  const esc = escapeHtml;
  const meta = [
    input.metaDescription
      ? `<meta name="description" content="${input.metaDescription}" />
  <meta property="og:title" content="${input.title}" />
  <meta property="og:description" content="${input.metaDescription}" />
  <meta property="og:type" content="website" />`
      : "",
    input.canonicalUrl
      ? `<meta property="og:url" content="${esc(input.canonicalUrl)}" />
  <link rel="canonical" href="${esc(input.canonicalUrl)}" />`
      : "",
    input.ogImage
      ? `<meta property="og:image" content="${esc(input.ogImage)}" />`
      : "",
    input.metaDescription
      ? `<meta name="twitter:card" content="summary" />
  <meta name="twitter:title" content="${input.title}" />
  <meta name="twitter:description" content="${input.metaDescription}" />`
      : "",
  ]
    .filter(Boolean)
    .join("\n  ");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <!-- ダーク閲覧時にスクロールバー等の UI クロームも追従させる -->
  <meta name="color-scheme" content="light dark" />
  <title>${input.title}</title>
  ${meta}
  <style>${BASE_CSS}${input.width === "wide" ? "    :root { --page-width: 960px; }\n" : ""}${input.pageCss ?? ""}  </style>
</head>
<body>
  <header class="hero">
    <div class="container">
      <p class="brand">ANIMEISHI</p>
      <p class="kind">${esc(input.kind)}</p>
      <h1>${input.heading}</h1>
      ${input.ownerLine ? `<p class="owner">${input.ownerLine}</p>` : ""}
      ${input.description ? `<p class="description">${esc(input.description)}</p>` : ""}
      ${input.statsHtml ?? ""}
    </div>
  </header>
  <main class="container">
  ${input.bodyHtml}
  </main>
  <footer class="site-footer container">
    <p><strong>Animeishi</strong> で共有されたページです</p>
  </footer>
</body>
</html>`;
}

/** 件数などをヒーローに並べる。値はプレーンテキスト（ここでエスケープしない数値を想定）。 */
export function statsHtml(stats: { label: string; value: number }[]): string {
  if (stats.length === 0) return "";
  return `<ul class="stats">${stats
    .map((s) => `<li><strong>${s.value}</strong> ${s.label}</li>`)
    .join("")}</ul>`;
}
