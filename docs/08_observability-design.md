# 08. オブザーバビリティ導入設計

Issue: https://github.com/KOU050223/animeishi/issues/79

## 目的

本番の API / アプリでエラーが起きたときに早く気づけるようにする。
Sentry を一次収集先に据え、Discord には Sentry Alert 経由で通知する。
アプリケーションコードに Discord Webhook を持たせる構成は取らない。

## 全体構成

```
[API Workers]  ──例外──→  Sentry (project: animeishi-api)  ──Alert──→ Discord
[Expo mobile]  ──例外──→  Sentry (project: animeishi-mobile) ─┘   （第二弾）

[Workers Logs] ── wrangler observability（production のみ有効化）
```

第一弾の範囲は API Workers 側の導入と通知運用の整備まで。
Expo 側・source map・tracing は第二弾以降に回す。

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
`sendDefaultPii: false` と併用し、`beforeSend` で `event.request.data` を
削除して `event.request.headers` に sanitizeHeaders を適用する。

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
  sendDefaultPii: false,
  tracesSampleRate: 0,                // tracing は第二弾で検討
  beforeSend: (event) => { ...sanitize + error.kind 付与 },
}
```

### エラー分類と送信ポリシー

`handleError(err, c)` が onError 本体。分類と送信可否をここに集約する。

| 例外 | 応答 | Sentry |
|------|------|--------|
| `HTTPException` status < 500（zod-validator の 400 等） | そのまま `err.getResponse()` | 送らない |
| `HTTPException` status >= 500 | そのまま | 送る（kind: unknown） |
| `AnnictApiError` status 4xx 系（401 トークン失効含む） | `annictErrorResponse`（401 → 401、それ以外 → 502） | 送らない（ユーザー・連携要因） |
| `AnnictApiError` status 0（通信失敗）・5xx 系 | `annictErrorResponse` で 502 | 送る（kind: annict） |
| その他（D1 エラー等の未処理例外） | `{ error, code: "internal_error", requestId }` の 500 | 送る（kind: db または unknown） |

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

## 第二弾以降（スコープ外）

- Expo / React Native への `@sentry/react-native` 導入と EAS source map upload
- API の source map upload と release 関連付けの CI 組み込み
- Annict / D1 / Clerk ごとの breadcrumb・タグの拡充
- `tracesSampleRate` を含む performance tracing
- `feature` タグの付与規則（route 単位の機能名）

## 実装時の確認事項

- `withSentry` が `queue` / `scheduled` ハンドラをカバーするか
  （SDK の現行バージョンで確認。対象外なら個別 try/catch を追加）
- `wrangler dev` / vitest-pool-workers で `CF_VERSION_METADATA` が
  どう解決されるか（未提供なら `"dev"` フォールバックで十分）
- `observability` セクションの per-env 上書きが `wrangler deploy --env
  production` に正しく効くか
