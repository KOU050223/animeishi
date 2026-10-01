# 08. オブザーバビリティ導入設計

Issue: https://github.com/KOU050223/animeishi/issues/79

## 目的

本番の API / アプリでエラーが起きたときに早く気づけるようにする。
Sentry を一次収集先に据え、Discord には Sentry Alert 経由で通知する。
アプリケーションコードに Discord Webhook を持たせる構成は取らない。

## 全体構成

```
[API Workers]  ──例外──→  Sentry (project: animeishi-api)  ──Alert──→ Discord
[Expo mobile]  ──例外──→  Sentry (project: animeishi-mobile) ─┘
```

第一弾で API Workers 側（PR #120）、第二弾で Expo 側（issue #121）を導入した。
source map の CI 組み込み・tracing は残課題。

## 採用する SDK

API 側は `@sentry/cloudflare` の `withSentry` で `ExportedHandler` 全体をラップする。
`@sentry/hono` の middleware 方式は fetch 専用で、queue consumer と scheduled
cron をカバーするには別途 try/catch を書く必要がある。この Worker には
image fallback の queue consumer と cron enqueue があり、これらの失敗も
拾いたいので、handler 全体をラップする方式を取る。

`nodejs_compat` は wrangler.toml に設定済みのため追加作業は不要。

## packages/observability

Workers と Expo で SDK 初期化は分けるが、イベントの命名と sanitize ルールは
monorepo で共有する。そのために `@animeishi/observability` を新設する。
このパッケージは `@sentry/*` に依存しない純 TS とし、各アプリが自分の SDK
初期化コードから呼ぶ。SDK の型に依存しない分、バージョン差異の影響を受けない。

```text
packages/observability/
  package.json           # @animeishi/observability、exports ./src/index.ts
  src/
    environment.ts       # AppEnvironment, resolveEnvironment
    release.ts           # buildRelease(app, versionId)
    tags.ts              # TAG_KEYS, ErrorKind, ERROR_KINDS
    sanitize.ts          # SENSITIVE_HEADERS, sanitizeHeaders
    index.ts
```

### 命名ルール

| 項目 | 値 |
|------|-----|
| environment | `production` / `preview` / `development`。`ENVIRONMENT` var を resolveEnvironment で正規化し、未設定・未知値は `development` に倒す |
| release | `animeishi-api@<CF_VERSION_METADATA.id>` / `animeishi-mobile@<version>`。`buildRelease("api", id)` が組み立てる |
| 共通タグ | `app`, `runtime`, `platform`, `feature`, `error.kind` |
| error.kind | `auth` / `annict` / `db` / `validation` / `upstream` / `unknown` |

### sanitize ルール

`SENSITIVE_HEADERS` = `authorization`, `x-annict-token`, `cookie`, `set-cookie`。
`sanitizeHeaders` はこれらを `[Filtered]` に置き換える。
request body・生のユーザー入力・個人情報は送信しない。API 側では
`dataCollection` で userInfo / cookies / httpBodies / urlQueryParams を
無効化し `x-annict-token` を deny したうえで、`beforeSend` で
`event.request.data` を削除し `event.request.headers` に
sanitizeHeaders を適用する（二段構えの防御）。

## API への組み込み

```text
services/api/src/
  observability.ts   # buildSentryOptions / classifyError / captureApiError / handleError
  index.ts           # requestId middleware、app.onError、withSentry ラップ
```

### index.ts の変更

```ts
app.use("*", requestId()); // hono/request-id。X-Request-Id ヘッダに載る
app.onError(handleError);

export default Sentry.withSentry(
  (env) => buildSentryOptions(env),
  {
    fetch: routes.fetch,
    queue: handleImageFallbackQueue,
    scheduled: ...,
  },
);
```

`withSentry` が自動で拾うのは handler の外に漏れた例外だけなので、
`app.onError` で応答に変換した例外は `captureApiError` で明示的に送る。
flush は `withSentry` 側が `ctx.waitUntil` で面倒を見る。

### buildSentryOptions

```ts
{
  dsn: env.SENTRY_DSN,
  enabled: Boolean(env.SENTRY_DSN),   // 未設定のローカルは完全 no-op
  environment: resolveEnvironment(env.ENVIRONMENT),
  release: buildRelease("api", env.CF_VERSION_METADATA?.id ?? "dev"),
  tracesSampleRate: 0,                // tracing は第二弾で検討
  dataCollection: {                   // PII・body・クエリ・秘匿ヘッダを送らない
    userInfo: false, cookies: false, httpBodies: [], urlQueryParams: false,
    httpHeaders: { request: { deny: ["x-annict-token"] } },
  },
  beforeSend: (event) => { ...sanitize + error.kind 付与 },
}
```

### エラー分類と送信ポリシー

`handleError(err, c)` が onError 本体。分類と送信可否をここに集約する。

| 例外 | 応答 | Sentry |
|------|------|--------|
| `HTTPException` status < 500（zod-validator の 400 等） | そのまま `err.getResponse()` | 送らない |
| `HTTPException` status >= 500 | そのまま | 送る（kind: unknown） |
| `AnnictApiError` status 401（トークン失効） | `annictErrorResponse` で 401 | 送らない（再連携で解決するユーザー・連携要因） |
| `AnnictApiError` その他（0=通信失敗、5xx、200 の異常応答、429 等） | `annictErrorResponse` で 502 | 送る（kind: annict） |
| その他（D1 エラー等の未処理例外） | `{ error, code: "internal_error", requestId }` の 500 | 送る（kind: db または unknown） |

`AnnictApiError.status` には上流の HTTP ステータスがそのまま入るため、
200 の GraphQL エラーや不正 JSON、429（レート制限）もクライアントには
502 として返る障害であり送信対象。非送信にするのは 401 のみ。
4xx 相当は原則送信しない。queue / scheduled で漏れた例外は `withSentry` が
自動 capture する。`error.kind` の判定は `beforeSend` 内で
`exception.values[].type`（エラークラス名）を見て行い、手動 capture と
自動 capture の両方に一律で効かせる。

captureApiError は `Sentry.withScope` で `requestId`, `route`（`c.req.routePath`）,
`method` をタグ・コンテキストとして付けてから capture する。
breadcrumb の最小セットはこのタグ群で代替し、別途積まない。

### ルート側の整理

各 route で「catch して `annictErrorResponse` に渡すだけ」のブロックは
`handleError` 側に寄せ、route は例外を握らずに流す。ただし以下のように
分岐や副作用を持つ catch は route に残す。

- Annict トークン連携時に 400/502 を分けている箇所
- 失効トークンの D1 行を掃除する箇所
- 画像フォールバック等、部分成功を意図して握りつぶす箇所

route に残した catch が例外を応答に変換する場合、onError は通らないため
上流障害（401 以外の AnnictApiError）は `captureApiError` で明示的に
送る。画像フォールバックのようなベストエフォート縮退は構造化 warn ログ
（`console.error`）のみで Sentry には送らない。

## wrangler.toml とシークレット

```toml
# release 識別用。デプロイごとの version id / tag が env に入る
[version_metadata]
binding = "CF_VERSION_METADATA"

# production で Workers Logs の invocation logs を有効化
[env.production.observability]
enabled = true
```

- `SENTRY_DSN` は `wrangler secret put SENTRY_DSN --env production` と
  `--env preview` で登録。同一 Sentry プロジェクトを使い、`environment`
  タグで分離する。ローカルは `.dev.vars` に書かず未設定のままにする
- `worker-configuration.d.ts` は `wrangler types` で再生成し、
  `SENTRY_DSN` / `ENVIRONMENT` / `CF_VERSION_METADATA` を型付けする
- `observability` キーの階層と優先度（トップレベルの `enabled` と
  `observability.logs.enabled` の関係）は実装時に wrangler の現行仕様で確認する

## テスト方針

- packages/observability: node の vitest で `sanitizeHeaders` /
  `resolveEnvironment` / `buildRelease` を単体テスト
- API: `@cloudflare/vitest-pool-workers` の既存プールを使う。
  `handleError` は `app.onError` に渡す前に通常関数として export し、
  `vi.mock("@sentry/cloudflare")` で `captureException` を spy する
  - 未処理例外 → 500 応答の shape（`{ error, code: "internal_error", requestId }`）
    と `X-Request-Id` ヘッダを検証
  - HTTPException 4xx → capture されないこと
  - AnnictApiError 401 → capture されず 401 応答、502 系 → capture されること

## 運用（Discord 通知）

Sentry 側の UI 設定なので手順を docs に記録する。

1. Sentry の Settings → Integrations で Discord を連携
2. Alert rule を作成: `environment equals production` の
   `a new issue is created`（+ 必要なら regression 復帰）を Discord チャンネルへ
3. preview / development は通知対象外にしておき、ノイズが出たら
   Alert 側の条件で絞る

## Expo / React Native への組み込み（第二弾・実装済み）

`@sentry/react-native`（Expo SDK 54 のピンは `~7.2.0`）を使う。
Web エクスポートも react-native-web 経由で同じ SDK が動くため、
iOS / Android / Web を 1 プロジェクト（`animeishi-mobile`）に集約し、
`platform` タグで区別する。API とはプロジェクトを分ける
（ランタイムもアラート閾値の性質も異なるため）。

```text
apps/mobile/
  app.json             # @sentry/react-native/expo plugin + ios.privacyManifests
  metro.config.ts      # getSentryExpoConfig（Debug ID 埋め込み）
  app/_layout.tsx      # initObservability() + Sentry.wrap(RootLayout)
  lib/
    observability.ts   # buildSentryOptions / initObservability / finalizeEvent
    apiError.ts        # ApiRequestError（HTTP ステータスを保持する Error）
```

### 初期化オプション（モバイル）

```ts
{
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: isSentryEnabled(dsn),        // 未設定・プレースホルダは完全 no-op
  environment: resolveEnvironment(process.env.EXPO_PUBLIC_ENVIRONMENT),
  release: buildRelease("mobile", Constants.expoConfig?.version ?? "dev"),
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: finalizeEvent,            // タグ付与・sanitize・送信可否判定
}
```

- `EXPO_PUBLIC_SENTRY_DSN` はクライアントに埋め込まれる公開値
  （DSN は公開前提の設計）。`eas.json` の `env` と GitHub Actions
  Variables の両方に登録する
- `EXPO_PUBLIC_ENVIRONMENT` は preview / production ビルド時に固定値で
  埋め込む。未設定は `resolveEnvironment` が `development` に倒す

### 送信ポリシー（モバイル）

API 側と同じく「4xx / ユーザー起因は issue にしない」を適用する。
クライアント側で HTTP ステータスを判別できるよう、`!res.ok` で投げる
例外は `ApiRequestError`（status フィールド付き）に統一した。

| イベント | 判定 | Sentry |
|---|---|---|
| `ApiRequestError` status < 500 | hint.originalException の status | 送らない |
| `ApiRequestError` status >= 500 | 同上 | 送る（kind: upstream） |
| 通信断（Network request failed / Failed to fetch / AbortError 等） | 型名・メッセージ | 送らない |
| その他（未処理例外・レンダリングエラー等） | — | 送る（kind は classifyEvent で推定） |

react-query でハンドリングされるクエリ・ミューテーションの失敗は
原則 Sentry に到達しない（処理済みエラーを送らない方針は API と同じ）。
Sentry に載るのは未処理例外・ErrorBoundary 捕捉・明示的 capture のみ。

sanitize は API と同じく `event.request.headers` に sanitizeHeaders を
適用し `event.request.data` を除去する。

### source map / シンボル

- ネイティブビルド: `@sentry/react-native/expo` プラグインが EAS Build 中に
  自動アップロードする（`SENTRY_AUTH_TOKEN` を EAS の sensitive env に登録、
  `app.json` の org slug を設定）
- Metro の serializer が Debug ID をバンドルへ埋め込むため、
  release/dist とアーティファクトの対応付けは Debug ID ベースで行われる
- EAS Update（OTA）・Web エクスポートの source map アップロードは
  手順のみ `docs/04_deployment.md` に記載（自動化は未整備）

### Discord 通知

プロジェクトが分かれたため、`animeishi-mobile` 側にも同条件
（`environment equals production`）の Alert rule を作成する。

## 残課題（スコープ外）

- API / Web の source map upload と release 関連付けの CI 組み込み
- EAS Update 時の source map アップロード自動化
- Annict / D1 / Clerk ごとの breadcrumb・タグの拡充
- `tracesSampleRate` を含む performance tracing
- `feature` タグの付与規則（route 単位の機能名）
- EAS Update の `expo-update-id` 等のタグ付け

## 実装時の確認事項

- `withSentry` が `queue` / `scheduled` ハンドラをカバーするか
  （SDK の現行バージョンで確認。対象外なら個別 try/catch を追加）
- `wrangler dev` / vitest-pool-workers で `CF_VERSION_METADATA` が
  どう解決されるか（未提供なら `"dev"` フォールバックで十分）
- `observability` セクションの per-env 上書きが `wrangler deploy --env
  production` に正しく効くか
