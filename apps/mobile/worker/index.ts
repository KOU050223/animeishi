// /share/* を API Worker へ転送し、未ログインの / を /welcome に移す。
// それ以外はプリレンダ HTML または SPA フォールバックの静的アセットへ渡す。
// 共有ページは API が OGP 付き静的 HTML を返すが、ユーザーに見せる URL を
// animeishi.uomi.dev に揃えるため Web 側が中継する（issue #408）。
//
// assets.run_worker_first に列挙したパスだけが本番でこのスクリプトに
// 届くが、ローカル開発やパターン変更時に他パスが来ても
// ASSETS へフォールバックできるよう、ここでもパスを見て振り分ける。

import {
  type SecurityHeadersEnv,
  withSecurityHeaders,
} from "./securityHeaders";

type Env = SecurityHeadersEnv & {
  /** 静的アセット（dist/）へのバインディング。 */
  ASSETS: Fetcher;
  /**
   * 転送先 API の公開オリジン（例: https://animeishi-api.uomi.dev）。
   * 転送時にリクエスト URL のオリジンをこれへ書き換える。
   * API は共有 HTML 内の画像プロキシ URL 等をリクエストのオリジンから
   * 組み立てるため、そのまま転送すると生成される <web オリジン>/images/works/:id
   * が静的アセット側へ流れて画像が壊れる。API のオリジンで見せれば
   * API 側の変更なしに正しい URL が返る。
   * （og:url / canonical は API が PUBLIC_WEB_URL から組み立てるため
   * ここでオリジンを隠しても新ドメインのまま。）
   */
  API_ORIGIN: string;
  /**
   * API Worker（animeishi-api-<env>）への Service Binding（本番のみ）。
   */
  API?: Fetcher;
  /**
   * "true" なら env.API があっても Service Binding を使わず API_ORIGIN への
   * 通常 fetch で転送する。PR プレビューは animeishi-web-production の
   * エイリアスとして発行されるため production の binding が継承されるが、
   * 転送先は PR の API プレビュー（binding はデプロイ済み Worker にしか
   * 届かず versions upload のバージョンは対象にできない）にしたいので、
   * preview-web.yml がこの var と API_ORIGIN を --var で注入する。
   * この fetch 経路が動くには、upload されたバージョンの compat flags に
   * global_fetch_strictly_public が必要: 同一 *.workers.dev サブドメインへの
   * fetch は Cloudflare 内部でルーティングされ、バージョンエイリアス名は
   * Worker 名として解決できず "Page not found" になるため（issue #762）。
   * preview-web.yml が --compatibility-flags で注入する。
   */
  SHARE_FORWARD_VIA_FETCH?: string;
};

function isSharePath(pathname: string): boolean {
  return pathname === "/share" || pathname.startsWith("/share/");
}

function hasClerkSession(request: Request): boolean {
  const cookies = request.headers.get("cookie")?.split(";") ?? [];
  const values = new Map(
    cookies.map((part) => {
      const [name, ...rest] = part.trim().split("=");
      return [name, rest.join("=")] as const;
    }),
  );
  const clientUat = values.get("__client_uat");
  if (clientUat === "0") return false;
  return Boolean(values.get("__session") || clientUat);
}

/** 公開プロフィール URL（/user/:uid）。名刺 QR・共有で外部に出る URL。 */
function isUserProfilePath(pathname: string): boolean {
  return /^\/user\/[^/]+\/?$/.test(pathname);
}

/**
 * OGP・検索目的で HTML を読みに来る既知の bot。SPA は JS なしでは
 * ユーザー固有のメタを返せないため、これらの UA には API の OGP HTML を
 * 返す。網羅はベストエフォート（未収録 bot は SPA が返るだけで悪化しない）。
 * bot 固有のトークンだけを使う。「line」「slack」「pinterest」のような
 * アプリ名そのままの部分一致だと、そのアプリ内ブラウザで開いた実ユーザーも
 * 静的 HTML に流されて操作できなくなるため（LINE 内ブラウザは "Line/x.y"、
 * リンク展開 bot は "Linepoker" のように UA が分かれている）。
 */
const CRAWLER_UA_TOKENS = [
  "googlebot",
  "google-inspectiontool",
  "bingbot",
  "slurp",
  "duckduckbot",
  "baiduspider",
  "yandex",
  "applebot",
  "twitterbot",
  "facebookexternalhit",
  "facebot",
  "linkedinbot",
  "discordbot",
  "slackbot",
  "slack-imgproxy",
  "telegrambot",
  "whatsapp",
  "linepoker",
  "pinterestbot",
  "hatena",
  "mastodon",
  "misskey",
  "bluesky",
  "embedly",
  "redditbot",
];

function isCrawler(request: Request): boolean {
  const ua = (request.headers.get("user-agent") ?? "").toLowerCase();
  return CRAWLER_UA_TOKENS.some((token) => ua.includes(token));
}

function addNoindex(html: string): string {
  return html.replace(
    "</head>",
    '  <meta name="robots" content="noindex" />\n</head>',
  );
}

/** Vary に値を重複なく併記した新しい Response を返す。 */
function withVary(res: Response, value: string): Response {
  const headers = new Headers(res.headers);
  const vary = new Set(
    (headers.get("vary") ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  vary.add(value.toLowerCase());
  headers.set("vary", [...vary].join(", "));
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function forwardToApi(
  request: Request,
  url: URL,
  env: Env,
  { crawler }: { crawler: boolean },
): Promise<Response> {
  const origin = new URL(env.API_ORIGIN);
  // host だけ書き換えるとポートが残る（localhost:8899 → api.example:8899
  // になり接続が張る）。hostname / port を分けてオリジンごと置き換える。
  url.protocol = origin.protocol;
  url.hostname = origin.hostname;
  url.port = origin.port;
  // 元リクエストの host ヘッダを引き継ぐと、公開 fetch で転送するときに
  // Cloudflare が host の zone（＝この Web Worker 自身）へルーティングして
  // /share/* が無限ループする。転送先の host は URL から決まるため除去する。
  // （hop-by-hop ヘッダも透過プロキシとして渡すべきでないので一緒に落とす）
  const headers = new Headers(request.headers);
  for (const name of [
    "host",
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]) {
    headers.delete(name);
  }
  if (crawler) {
    // API は Accept: text/html のときだけ OGP HTML を返す。bot の
    // Accept: */* をそのまま流すと JSON が返るため明示する。
    // 閲覧者依存のレスポンス（ブロック判定等）に session が混ざらないよう
    // 資格情報も落とす。
    headers.set("accept", "text/html");
    headers.delete("cookie");
    headers.delete("authorization");
  }
  const forwarded = new Request(url, {
    method: request.method,
    headers,
    body: request.body,
  });
  if (env.API && env.SHARE_FORWARD_VIA_FETCH !== "true") {
    return env.API.fetch(forwarded);
  }
  return fetch(forwarded);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (isSharePath(pathname)) {
    return forwardToApi(request, url, env, { crawler: false });
  }

  if (
    pathname === "/" &&
    request.method === "GET" &&
    !hasClerkSession(request)
  ) {
    // 同一 URL の応答が Cookie で分かれるため、ブラウザ・中間キャッシュが
    // 別状態の応答を使い回さないよう Vary を付ける（下の 200 側にも付く）。
    return withVary(
      Response.redirect(new URL("/welcome", request.url), 302),
      "Cookie",
    );
  }

  // /user/:uid はクローラにだけ API の OGP HTML を返す。ブラウザは
  // 従来どおり SPA（フレンド申請等のインタラクションを維持するため）。
  // 同一 URL で UA により応答が変わるので両分岐に Vary: User-Agent を付ける。
  // 転送は GET/HEAD のみ。API の該当ルートは GET 専用で、UA 偽装した
  // POST ボディを API に流す意味がないため SPA へ回す。
  if (isUserProfilePath(pathname)) {
    if (
      (request.method === "GET" || request.method === "HEAD") &&
      isCrawler(request)
    ) {
      // API は /:uid のみ受け付ける strict ルーティングのため、
      // 末尾スラッシュ付き URL をそのまま転送すると 404 になる
      url.pathname = pathname.replace(/\/$/, "");
      const res = await forwardToApi(request, url, env, { crawler: true });
      return withVary(res, "User-Agent");
    }
    const res = await env.ASSETS.fetch(request);
    return withVary(res, "User-Agent");
  }

  // 公開4ページはプリレンダ HTML をそのまま配信する。
  if (["/welcome", "/privacy", "/terms", "/support"].includes(pathname)) {
    return env.ASSETS.fetch(request);
  }

  // SPA フォールバックには noindex を付ける。
  // HTML 以外の応答（アセット・manifest 等）はそのまま返す。
  if (request.method !== "GET" && request.method !== "HEAD") {
    return env.ASSETS.fetch(request);
  }
  // HEAD も GET と同じ注入済みヘッダを返すため、本文取得は GET で行う。
  const assetRequest =
    request.method === "GET"
      ? request
      : new Request(request.url, { headers: request.headers });
  const res = await env.ASSETS.fetch(assetRequest);
  if (!(res.headers.get("content-type") ?? "").includes("text/html")) {
    return res;
  }
  const html = addNoindex(await res.text());
  const headers = new Headers(res.headers);
  // 本文書き換えで古くなるキャッシュ検証系のヘッダを落とす。
  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("content-encoding");
  let response = new Response(request.method === "HEAD" ? null : html, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
  // GET / は Cookie の有無で 302 と分かれるため、200 側にも Vary を付ける。
  if (pathname === "/") {
    response = withVary(response, "Cookie");
  }
  return response;
}

export default {
  async fetch(request, env) {
    // public/_headers は Worker が返した応答には付かないため、ここで全応答に付ける。
    return withSecurityHeaders(await route(request, env), env);
  },
} satisfies ExportedHandler<Env>;
