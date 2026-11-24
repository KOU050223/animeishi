/**
 * QR コードに埋め込まれたユーザー ID を抽出するパーサー。
 *
 * カメラやネイティブ API に依存しない純粋関数として実装しているため、
 * iOS / Android / Web のどのクライアントでも同じロジックが動作し、
 * Jest で一度テストすれば全環境での挙動が保証される。
 *
 * 対応フォーマット（docs/archive/01 PR8 仕様）:
 *  1. 旧 URL        : https://animeishi-viewer.web.app/user/{uid} など任意ホストの /user/{uid}
 *  2. カスタムスキーム: animeishi://user/{uid} / animeishi://{uid}
 *  3. 生 UID         : Clerk ID (user_xxxxx) または旧 Firebase 28 文字 UID
 *
 * ホスト名はハードコードせず「パス末尾の UID を取り出す」寛容な実装にしているため、
 * 将来 Web 版の URL が変わってもパーサーを書き換える必要はない。
 */

/** Clerk のユーザー ID（user_ + base58 英数字）。 */
const CLERK_ID_PATTERN = /^user_[0-9A-Za-z]+$/;

/** 旧 Firebase の 28 文字 UID（英数字）。 */
const LEGACY_UID_PATTERN = /^[0-9A-Za-z]{28}$/;

/** 抽出候補が有効なユーザー ID かどうかを判定する。 */
export function isValidUserId(value: string): boolean {
  return CLERK_ID_PATTERN.test(value) || LEGACY_UID_PATTERN.test(value);
}

/**
 * スキャン / 入力された文字列からユーザー ID を抽出する。
 * 抽出できない場合は null を返す。
 */
export function parseUserIdFromQr(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. そのものが UID（生 UID フォーマット）
  if (isValidUserId(trimmed)) return trimmed;

  // 2. URL / スキームとしてパスを分解し、末尾セグメントから UID を探す。
  const candidate = extractFromUrlLike(trimmed);
  if (candidate && isValidUserId(candidate)) return candidate;

  return null;
}

/** 対面交換 QR のクエリパラメータ名（POST /me/friends の qrToken に渡す）。 */
const QR_TOKEN_PARAM = "qt";

// オフライン交換 QR のパラメータ名（issue #663、設計
// docs/13_offline-exchange-design.md）。表示側がオンラインで qt を
// 取れないときだけ `?ot=` が載る（フォールバック併記）。`?mc=` は
// 読み取り側がオフラインでも相手の名前を出せるミニ名刺。
const QR_OFFLINE_TOKEN_PARAM = "ot";
const QR_MINI_MEISHI_PARAM = "mc";

/** QR の `?mc=` に載るミニ名刺。読み取り直後にオフラインで名前を出すための最小情報。 */
export type MiniMeishi = {
  username?: string;
  avatarUrl?: string;
};

export type QrPayload = {
  userId: string;
  /** 対面交換 QR にだけ載る短期トークン。共有 URL の QR には無い。 */
  qrToken?: string;
  /** オフライン交換用の長寿命トークン。qt を取れない表示側の QR にだけ載る。 */
  offlineToken?: string;
  /** ミニ名刺（`?mc=`）。デコードできない QR では undefined。 */
  miniMeishi?: MiniMeishi;
};

/** `?name=` / `&name=` の値を取り出す。無ければ undefined。 */
function extractParam(raw: string, name: string): string | undefined {
  return raw.match(new RegExp(`[?&]${name}=([^&#\\s]+)`))?.[1];
}

/** base64url → バイナリ文字列。不正な入力は例外を投げず null。 */
function decodeBase64Url(value: string): string | null {
  try {
    const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
    return atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

/**
 * ミニ名刺を `?mc=` に載せる base64url 文字列へ変換する。
 * username / avatarUrl のどちらも無いときは null（パラメータごと付けない）。
 */
export function encodeMiniMeishi(miniMeishi: MiniMeishi): string | null {
  const payload: { username?: string; avatarUrl?: string } = {};
  if (miniMeishi.username) payload.username = miniMeishi.username;
  if (miniMeishi.avatarUrl) payload.avatarUrl = miniMeishi.avatarUrl;
  if (!payload.username && !payload.avatarUrl) return null;
  // btoa は Latin-1 しか受け付けないため UTF-8 へエスケープしてから渡す
  // （日本語のユーザー名を載せるため。decodeURIComponent は不正列で
  // URIError を投げるが、ここで作るのは必ず有効なエスケープ列）。
  const bin = unescape(encodeURIComponent(JSON.stringify(payload)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `?mc=` の値をミニ名刺へ戻す。壊れた値は QR ごと無効にせず undefined。 */
function decodeMiniMeishi(encoded: string): MiniMeishi | undefined {
  const bin = decodeBase64Url(encoded);
  if (bin === null) return undefined;
  try {
    const value: unknown = JSON.parse(decodeURIComponent(escape(bin)));
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const miniMeishi: MiniMeishi = {};
    if (typeof record.username === "string") {
      miniMeishi.username = record.username;
    }
    if (typeof record.avatarUrl === "string") {
      miniMeishi.avatarUrl = record.avatarUrl;
    }
    return miniMeishi.username || miniMeishi.avatarUrl ? miniMeishi : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 交換 QR に埋め込む URL を組み立てる（issue #417/#663）。
 * - qt があれば `?qt=`、無ければキャッシュ済みの ot があれば `?ot=`
 *   （オーナー決定 2026-11-21: フォールバック併記）。
 * - トークンがどちらかあればミニ名刺 `&mc=` も付ける。トークン無しの
 *   申請フロー用 URL には付けず shareUrl をそのまま返す。
 */
export function buildQrExchangeUrl(
  shareUrl: string,
  params: {
    qt?: string;
    ot?: string | null;
    miniMeishi?: MiniMeishi;
    /**
     * qt があっても ot を併記する。画面に出す QR では ot を広めないよう
     * qt を優先するが、近づけて交換（issue #693）で 10cm の相手 1 人だけに
     * 送るデータでは、qt の期限後にオフラインの交換キューを同期できるよう
     * 両方を載せる。
     */
    includeOfflineWithQt?: boolean;
  },
): string {
  const query: string[] = [];
  if (params.qt) {
    query.push(`${QR_TOKEN_PARAM}=${encodeURIComponent(params.qt)}`);
  }
  if (params.ot && (!params.qt || params.includeOfflineWithQt)) {
    query.push(`${QR_OFFLINE_TOKEN_PARAM}=${encodeURIComponent(params.ot)}`);
  }
  if (query.length > 0 && params.miniMeishi) {
    const mc = encodeMiniMeishi(params.miniMeishi);
    if (mc) query.push(`${QR_MINI_MEISHI_PARAM}=${mc}`);
  }
  return query.length > 0 ? `${shareUrl}?${query.join("&")}` : shareUrl;
}

/**
 * QR から「ユーザー ID + 対面交換トークン」を取り出す（issue #417）。
 * トークンは対面交換画面の QR にだけ `?qt=` で付く。名刺画像・共有
 * リンクの QR には付かず、その場合は qrToken が undefined になる
 * （＝共有 URL 扱いで申請フローに回す）。
 * `?ot=` / `?mc=` はオフライン交換用（issue #663）。旧形式の QR には
 * 無いため undefined になる。
 */
export function parseQrPayload(
  raw: string | null | undefined,
): QrPayload | null {
  const userId = parseUserIdFromQr(raw);
  if (!userId || !raw) return null;

  // `?qt=` / `&qt=` を拾う。値は exp.base64urlsig 想定だが、形式の検証は
  // サーバー側に任せてここでは素通しする。
  const qtRaw = extractParam(raw, QR_TOKEN_PARAM);
  let qrToken: string | undefined;
  if (qtRaw) {
    try {
      qrToken = decodeURIComponent(qtRaw);
    } catch {
      // 不正なパーセントエンコードは URIError を投げる。カメラコールバックで
      // 例外を握らずクラッシュするのを防ぐため、QR ごと無効扱いにする。
      return null;
    }
  }

  // ot / mc は無い・壊れた値でも QR 自体は有効に保つ（qt 側の成立や
  // 申請フローを潰さない）。
  const otRaw = extractParam(raw, QR_OFFLINE_TOKEN_PARAM);
  let offlineToken: string | undefined;
  if (otRaw) {
    try {
      offlineToken = decodeURIComponent(otRaw);
    } catch {
      offlineToken = undefined;
    }
  }
  let miniMeishi: MiniMeishi | undefined;
  const mcRaw = extractParam(raw, QR_MINI_MEISHI_PARAM);
  if (mcRaw) {
    try {
      miniMeishi = decodeMiniMeishi(decodeURIComponent(mcRaw));
    } catch {
      miniMeishi = undefined;
    }
  }

  return { userId, qrToken, offlineToken, miniMeishi };
}

/**
 * URL もしくはカスタムスキーム文字列からユーザー ID 候補を取り出す。
 * `/user/{uid}` パターンを優先し、なければパス末尾セグメントを候補とする。
 */
function extractFromUrlLike(input: string): string | null {
  // クエリ・フラグメントを除去
  const withoutQuery = input.split(/[?#]/, 1)[0];

  // スキーム（animeishi://, https://）以降のパス部分を取得
  const schemeStripped = withoutQuery.replace(
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//,
    "",
  );

  // パスセグメントに分解（空要素は除外）
  const segments = schemeStripped.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  // `/user/{uid}` 形式を優先
  const userIdx = segments.lastIndexOf("user");
  if (userIdx >= 0 && userIdx + 1 < segments.length) {
    return segments[userIdx + 1];
  }

  // それ以外はパス末尾を候補にする（animeishi://{uid} 等）
  return segments[segments.length - 1] ?? null;
}
