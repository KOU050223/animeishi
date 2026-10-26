// 外部リソースへ fetch する経路で共有する HTTP ユーティリティ。

export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * 公開インターネット上の画像 URL か（SSRF 対策、Devin Review 指摘）。
 * 画像 URL は上流 API（Annict/AniList/Jikan）や DB 由来とはいえ、
 * 悪意ある/壊れたデータで内部アドレスを指されると、その応答を
 * 公開配信してしまう。画像 CDN は必ず https の公開ドメイン名かつ
 * 標準ポートのため、以下を拒否する:
 *   * https 以外のスキーム
 *   * IP リテラル（IPv4・[v6]・0x/10進混在表記を含め、数字・16進・
 *     ドット・コロンのみで構成されるホスト）
 *   * ドット無し / localhost / .local / .internal / .lan / .home / .corp
 *   * 標準外ポート（443・暗黙ポート以外）
 * 公開ドメインの DNS が内部 IP を指すリバインディングは fetch 層では防げず、
 * 残余リスクとして残る。/share/image-proxy と作品画像 prefetch で共通利用。
 */
export function isPublicImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host.includes(".") ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".lan") ||
    host.endsWith(".home") ||
    host.endsWith(".corp") ||
    /^[0-9a-f.:x]+$/.test(host.replace(/^\[|\]$/g, ""))
  ) {
    return false;
  }
  if (parsed.port && parsed.port !== "443") {
    return false;
  }
  return true;
}

export type RedirectFollowResult =
  | { kind: "final"; response: Response }
  | {
      kind: "failed";
      reason:
        | "fetch_error"
        | "blocked"
        | "missing_location"
        | "too_many_redirects";
    };

/**
 * redirect: "manual" でリダイレクトを 1 ホップずつ追う共通ループ。
 * 遷移先 URL は isAllowed で都度検証し、通らない宛先には行かない
 * （リダイレクト経由で内部宛先・許可外ホストへ連れて行かれる SSRF を防ぐ）。
 * 初期 URL の検証は呼び出し側が行い、isAllowed は遷移先にだけ適用する。
 */
export async function fetchFollowingRedirects(
  initialUrl: string,
  options: {
    timeoutMs: number;
    maxRedirects: number;
    isAllowed: (url: string) => boolean | Promise<boolean>;
    fetchImpl?: typeof fetch;
  },
): Promise<RedirectFollowResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  let target = initialUrl;
  for (let hop = 0; hop <= options.maxRedirects; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(target, {
        signal: AbortSignal.timeout(options.timeoutMs),
        redirect: "manual",
      });
    } catch {
      return { kind: "failed", reason: "fetch_error" };
    }
    if (!REDIRECT_STATUSES.has(res.status)) {
      return { kind: "final", response: res };
    }
    const location = res.headers.get("location");
    if (!location) {
      return { kind: "failed", reason: "missing_location" };
    }
    let next: URL;
    try {
      next = new URL(location, target);
    } catch {
      return { kind: "failed", reason: "missing_location" };
    }
    if (!(await options.isAllowed(next.toString()))) {
      return { kind: "failed", reason: "blocked" };
    }
    target = next.toString();
  }
  return { kind: "failed", reason: "too_many_redirects" };
}

/**
 * レスポンスボディを maxBytes までストリーム読みする。
 * 超過が確定した時点で reader.cancel() して中断し、残りを受け取らない。
 * 読み取り自体の失敗（切断・シグナル発火）は tooLarge: false の失敗として返す。
 * content-length の無い応答を arrayBuffer() で読むと全量メモリに乗るため、
 * 外部から画像等を取り込む経路ではこちらを使う。
 */
export async function readBodyWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ ok: true; data: ArrayBuffer } | { ok: false; tooLarge: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (stream) {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { ok: false, tooLarge: true };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, tooLarge: false };
    } finally {
      reader.releaseLock();
    }
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, data: data.buffer };
}
