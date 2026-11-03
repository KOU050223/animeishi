// /share/* を API Worker へ転送し、それ以外を静的アセット
// （Expo Router の web エクスポート + SPA フォールバック）へ渡す Worker。
// 共有ページは API が OGP 付き静的 HTML を返すが、ユーザーに見せる URL を
// animeishi.uomi.dev に揃えるため Web 側が中継する（issue #408）。
//
// assets.run_worker_first = ["/share/*"] により本番では /share/* だけが
// このスクリプトに届くが、ローカル開発やパターン変更時に他パスが来ても
// ASSETS へフォールバックできるよう、ここでもパスを見て振り分ける。

type Env = {
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
   */
  SHARE_FORWARD_VIA_FETCH?: string;
};

function isSharePath(pathname: string): boolean {
  return pathname === "/share" || pathname.startsWith("/share/");
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (!isSharePath(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
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
    const forwarded = new Request(url, {
      method: request.method,
      headers,
      body: request.body,
    });
    if (env.API && env.SHARE_FORWARD_VIA_FETCH !== "true") {
      return env.API.fetch(forwarded);
    }
    return fetch(forwarded);
  },
} satisfies ExportedHandler<Env>;
