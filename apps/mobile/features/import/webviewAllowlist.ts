// dアニメ取り込み画面の WebView で許可する遷移先の判定。
//
// 許可するのは dアニメストア本体と、dアカウント認証で実際に遷移する
// docomo のホストだけ。docomo の公式案内ではログイン関連ページは
// *.smt.docomo.ne.jp で提供される（例: id.smt.docomo.ne.jp が OIDC 認可、
// cfg.smt.docomo.ne.jp がログインフォーム・2段階認証）。それ以外の
// ドメインへ WebView 内で遷移できると審査の「無制限の Web アクセス」に
// 見なされ得るため、store.config.json の unrestrictedWebAccess: false と
// 揃えて許可外は外部ブラウザへ渡す（呼び出し側の責務）。

// ホストの直後はポート・パス等の区切り文字だけを認める。`@`（userinfo）や
// 末尾ドットの偽装（`https://animestore.docomo.ne.jp@evil.com/` 等）を
// 許可ホストと誤認しないため。
const DANIME_WEBVIEW_HOST_PATTERN =
  /^https:\/\/([a-z0-9.-]+?)(:[0-9]+)?([/?#]|$)/i;

export function isDanimeWebViewUrlAllowed(url: string): boolean {
  // WebView が内部的に読み込む空ページは常に許可する。
  if (url === "about:blank") return true;
  const host = DANIME_WEBVIEW_HOST_PATTERN.exec(url)?.[1]?.toLowerCase();
  if (host == null) return false;
  return (
    host === "animestore.docomo.ne.jp" || host.endsWith(".smt.docomo.ne.jp")
  );
}
