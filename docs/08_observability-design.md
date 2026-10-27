# 08. オブザーバビリティ導入設計

Issue: https://github.com/KOU050223/animeishi/issues/79

## 目的

本番の API / アプリでエラーが起きたときに早く気づけるようにする。
Sentry を一次収集先に据える。Discord への通知は当初 Sentry Alert 経由だったが、
Sentry org が無料（Developer）プランになり Discord を通知先にしたアラートルールを
新規作成できなくなったため、API Workers の重大な障害とユーザー通報を
Worker から Discord Webhook へ直接送る（「Discord 通知」節）。
モバイルアプリには Webhook を持たせない。

## 全体構成

```
[API Workers]  ──例外──→  Sentry (project: animeishi-api)  ──メール通知
      └──5xx/上流障害・cron 連続失敗・ユーザー通報──→  Discord Webhook (#bot-log)  ※重複抑止付き
[Expo mobile]  ──例外──→  Sentry (project: animeishi-mobile) ──メール通知
```

第一弾で API Workers 側（PR #120）、第二弾で Expo 側（issue #121）を導入した。
source map の CI 組み込み・tracing は残課題。

## 採用する SDK

API 側は `@sentry/cloudflare` の `withSentry` で `ExportedHandler` 全体をラップする。
`@sentry/hono` の middleware 方式は fetch 専用で、scheduled cron をカバーするには
別途 try/catch を書く必要がある。この Worker には image fallback の cron 解決が
あり、その失敗も拾いたいので、handler 全体をラップする方式を取る。

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
4xx 相当は原則送信しない。scheduled で漏れた例外は `withSentry` が
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
- `SENTRY_DSN` / `ENVIRONMENT` / `CF_VERSION_METADATA` の型は
  `apps/api/src/observability.ts` の `ObservabilityBindings` で付ける
- `observability` キーの階層と優先度（トップレベルの `enabled` と
  `observability.logs.enabled` の関係）は実装時に wrangler の現行仕様で確認する

## テスト方針

- packages/observability: node の vitest で `sanitizeHeaders` /
  `resolveEnvironment` / `buildRelease` を単体テスト
- API: `@cloudflare/vitest-plugin`（旧 `@cloudflare/vitest-pool-workers`）の既存プールを使う。
  `handleError` は `app.onError` に渡す前に通常関数として export し、
  `vi.mock("@sentry/cloudflare")` で `captureException` を spy する
  - 未処理例外 → 500 応答の shape（`{ error, code: "internal_error", requestId }`）
    と `X-Request-Id` ヘッダを検証
  - HTTPException 4xx → capture されないこと
  - AnnictApiError 401 → capture されず 401 応答、502 系 → capture されること

## 運用（Discord 通知）

### Worker からの直接通知（現行）

Sentry の Developer プランでは Discord を通知先にしたアラートルールを新規作成できない
（`400 Organization does not allow this action type: discord`）。
そのため Sentry へ送るサーバー側の障害を、`src/lib/discordAlert.ts` が Discord Webhook にも送る。
対象は `handleError` が受ける障害（未処理例外の 500、HTTPException 5xx、
401 以外の AnnictApiError → 502）と、ルートが応答に変換して onError を通らない障害
（Workers AI の 502、Annict 認可の 502、視聴履歴一括更新の部分失敗、OpenAPI サブアプリの
HTTPException 5xx）。後者は `reportApiFailure(err, c, status)` で Sentry 送信と通知を同時に行う。

- 送信は `ctx.waitUntil` で行い、応答は待たせない
- 本文はルートパターン（`/user/:uid` の形）・メソッド・返したステータス・error.kind・件数だけ。
  実際のパス・クエリ文字列・例外メッセージ・ユーザー ID は入れない
- `allowed_mentions: { parse: [] }` でメンションを解釈させない
- 重複抑止: KV `ALERT_STATE` に印を `expirationTtl: 1800`（30 分）で付け、印がある間は
  同じ障害を送らない。印は障害の組み合わせごとに付けるので、別種の障害は抑止中でも通知される
  - 全ルートに広がる基盤系（`annict` / `upstream` / `db` / `auth`）は `api:<error.kind>:<status>`
  - それ以外（`unknown` 等）は原因がルートごとに違うため `api:<error.kind>:<status>:<METHOD> <route>`
  - KV は結果整合なので、同じ isolate 内の同時発生（一括更新で何十件も失敗する等）は
    メモリ上の印でも抑える
  - KV の読み書きに失敗しても通知は送る（KV は重複抑止のためだけ）
- `DISCORD_WEBHOOK_URL`（Workers Secret）が未設定なら何もしない

### cron ジョブの失敗通知（issue #233）

`scheduled` ハンドラの各ジョブ（`mal_id_search` / `image_fallback`）は
`runCronJob`（`src/observability.ts`）で実行し、失敗をジョブごとに catch して
`Sentry.captureException` に送る（片方の失敗でもう片方は止まらない）。
Discord への通知は `notifyCronFailure`（`src/lib/discordAlert.ts`）が行うが、
一過性の単発失敗では送らず、**連続 2 回（`CRON_FAILURE_THRESHOLD`）の失敗**で送る。

- 連続失敗回数は `ALERT_STATE` の `cron_fail_count:<job>` に保持し、
  ジョブが成功したら `clearCronFailures` で消す（成功は通知しない）。
  KV 未バインド・読み書き失敗時は isolate 内メモリで数える
- 通知の重複は API 障害と同じ印方式（キーは `cron:<job>`、30 分 TTL）で抑止し、
  カウントは閾値到達後も進み続ける（本文に連続回数を載せる）
- 本文に入れるのは `cron:<job>` と連続回数だけ。例外メッセージは送らない

セットアップ（初回のみ）:

1. Discord `#bot-log` のチャンネル設定 → 連携サービス → ウェブフックで
   animeishi 専用の Webhook を作る（他プロジェクトと分け、漏れたら単独で作り直せるようにする）
2. `cd services/api && pnpm exec wrangler secret put DISCORD_WEBHOOK_URL --env production`
3. KV namespace `ALERT_STATE` は wrangler.toml の `[[env.production.kv_namespaces]]`
   に定義済み

モバイルアプリに Webhook URL を埋め込むのは禁止（アプリを分解すれば誰でも抜き出して
投稿できる）。アプリのエラーは Sentry のメール通知で受け、Discord に流したい場合は
Workers 側を経由させる。

### Sentry Alert 経由（旧構成）

トライアル中に作成した Discord 宛てのアラートルール（`production errors -> Discord #bot-log` 等）は
Sentry 上に残っている。新規作成・編集はできないため、上記の直接通知を正とする。
当時の手順:

1. Sentry の Settings → Integrations で Discord を連携
2. Alert rule を作成: `environment equals production` の
   `a new issue is created`（+ 必要なら regression 復帰）を Discord チャンネルへ
3. preview / development は通知対象外にしておき、ノイズが出たら
   Alert 側の条件で絞る

### ユーザー通報の通知（UGC モデレーション）

`POST /users/:id/report` は `notifyUserReport` で 2 系統に送る。

- **Discord Webhook**（`src/lib/discordAlert.ts` の `notifyUserReport`、
  issue #232）: Sentry の Developer プランでは Discord を通知先にした
  アラートルールを作れないため、障害通知と同じ Webhook へ
  `ctx.waitUntil` で直接送る。本文は「通報あり」と直近の件数だけで、
  通報者・被通報者の ID や通報理由は載せない
  （詳細は `pnpm task reports:list` で確認する運用）。
  - 連投は `REPORT_SUPPRESS_SECONDS`（5 分）で抑止する。
    障害通知の 30 分より短くしているのは、通報は 1 件ずつ気づきたいため。
    変えるときはこの定数 1 か所を直す。
  - 抑止中に届いた通報は送らず、件数だけ `ALERT_STATE` の
    `user_report_pending` に積み、次の通知に「直近 N 件」として載せる
    （N は抑止中の分と今回の 1 件の合計）。
    KV 未バインド・読み書き失敗時は isolate 内メモリで数える
    （cron の連続失敗カウントと同じ考え方）。
- **Sentry**: 引き続き `captureMessage("user_report_received", "warning")`
  を送る。Webhook 本文に詳細を載せないため、通報者・被通報者 ID と
  理由は Sentry の context に残す。fingerprint を
  `["user_report", <reported_user_id>]` に固定しているため、
  Sentry 上では**通報されたユーザーごとに Issue が分かれ**、
  `report.reported_user_id` タグで検索もできる
  （例: `report.reported_user_id:user_xxx`）。

対応状況の管理は D1 の `reports` テーブルで行う（issue #186）。
各通報は `status`（`open` / `resolved` / `dismissed`）・
`resolution_note`（対応メモ）・`resolved_at`（対応日時）を持ち、
棚卸し・状態更新は `apps/api/scripts/reports.sh`（wrangler d1
execute ベース）から行う。Taskfile 経由では
`pnpm task reports:list`（未対応一覧・`--by-user` で被通報ユーザー別集計）、
`pnpm task reports:resolve|dismiss NOTE='対応メモ' -- <id>`、
`pnpm task reports:reopen -- <id>` が使える（メモはシェル再解釈を避けるため
NOTE 環境変数経由）。
Sentry の Issue ステータスは通知側の既読管理として併用してよいが、
対応済みかどうかの正は `reports.status` とする。

管理画面・管理者 API は認可設計が未決のため作っていない。
累積通報による自動凍結等のエスカレーションも未実装（閾値の検討が必要）。

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

`animeishi-mobile` にもトライアル中に Discord 宛ての Alert rule を作成したが、
無料プランでは新規作成・編集ができない。モバイルのエラーは Sentry のメール通知で受ける
（Webhook をアプリに持たせない理由は「運用（Discord 通知）」節を参照）。

## ファネル計測（Annict 連携コンバージョン、issue #64）

未連携ユーザーへの連携誘導がどれだけ連携完了に繋がるかを計測する。
新規 SaaS は入れず、Sentry Logs（`enableLogs` + `Sentry.logger`）を使う。
Logs は Issue を作らないため大量発生してもアラートのノイズにならず、
Explore で属性フィルタ・集計ができる。

```text
イベント: annict_connect_funnel（1 本。step 属性で段階を分ける）
属性:
  annict.step     prompt_view | cta_tap | oauth_result
  annict.surface  watch_history | anime_list | tier_list |
                  character_tier_list | meishi_image_library |
                  meishi_image_search | home_card | profile_card
  annict.result   success | cancelled | error   （oauth_result のみ）
  annict.reason   error の理由（state_mismatch / exchange_failed / ...）
  annict.user_key Clerk userId のソルト付き SHA-256 先頭16文字（PII 非送信）
  platform        ios | android | web
```

命名・surface 一覧は `@animeishi/observability`（`src/funnel.ts`）で管理し、
送信ロジックは `apps/mobile/lib/annict/funnel.ts` に集約する。

### 送信点

- `prompt_view`: `AnnictSoftGate` のマウント時、
  `AnnictConnectionCard` で連携 CTA が見える状態になった時。
  スクロールしないと画面に出ない位置でも計上される「レンダリング回数」
  であり、実視認ではない点に注意。
- `cta_tap`: 両コンポーネントの「連携する」タップ時。
  連打時は in-flight ガードで後続がキャンセルされ、
  `cta_tap` だけが残り `oauth_result` が出ない点に注意（離脱との区別）。
- `oauth_result`: OAuth の結果が確定した時点。
  - ネイティブ: `useAnnictConnect` の `connect()` 内で完結するため、
    結果（success/cancelled/error+reason）をその場で送る。
    in-flight ガードによる再入の cancelled は結果ではないため送らない。
  - Web: `connect()` は authorize へのページ遷移で終わり結果が未確定なため、
    surface を sessionStorage に退避し、コールバック側の
    `exchangeAnnictWebCallback` が結果と一緒に送る。
    authorize 先で中断して戻らなかった場合はイベント自体が発生しないため、
    「cta_tap はあるが oauth_result が無い」差分が Web の途中離脱になる。
    （Web では connect() の遷移前失敗 not_configured / storage_unavailable は
    connect() 側が送る）
  - `/annict` への直接アクセス等、誘導を経ないコールバック処理でも
    `oauth_result` は送られる（`surface` 無し・`reason=state_mismatch` 等）。
    ファネル集計では `surface` 有りで絞るか reason で除外して読む。

Web の注意点: Sentry Logs はバッファに溜まって一定間隔で送信される。
authorize へのページ遷移でバッファごと捨てられると `cta_tap` 等が
消失するため、`connect()` は遷移直前に `flushAnnictFunnel()` で進行中の
計測送信がバッファに乗るのを待ち、`Sentry.flush()`（時間上限付き）で
送信完了を待ってから `location.href` を更新している。

### 集計方法

Sentry の Logs / Explore で `message = annict_connect_funnel` に絞り、
`annict.step` で件数比較（表示→タップ→成功の各率）、
`annict.reason`・`annict.surface` で離脱ポイントを見る。
`environment = production` で絞ること（開発環境の StrictMode による
effect 二重実行で `prompt_view` が倍計上されうるため）。
user_key で同一ユーザーのユニークコンバージョンも概算できる。

### ダッシュボード（再現手順）

ファネル用の Sentry ダッシュボード「Annict 連携ファネル」は
`scripts/sentry/setup-annict-funnel-dashboard.sh` で作成する（logs データセット、
KPI 3 枚・ステップ別推移・OAuth 結果内訳・導線別表・失敗理由表）。

```bash
sentry auth login   # ダッシュボード作成・編集権限（org:write 相当）のあるアカウント/トークンで
bash scripts/sentry/setup-annict-funnel-dashboard.sh [org] [project]
```

スクリプトは冪等で、ダッシュボードが既にあれば作成をスキップし、同名ウィジェットが
既にあるものは追加しない。途中で失敗してもそのまま再実行すればよい。
ただし既存ウィジェットの定義（クエリ・表示形式）は更新しないため、変更したい場合は
Sentry 上で該当ウィジェットを削除してから再実行する。

## UI イベント計測（主要ボタンの利用状況、issue #214）

Annict ファネル計測（issue #64）の仕組みを汎用化し、名刺交換・Tier 表・
AI 分析・視聴ステータス・お気に入りなど主要ボタンの押下を Sentry Logs で
計測する。「何回・いつ・どの画面で」押されたかを把握するのが目的。
新規 SaaS（プロダクト分析基盤）は入れず、既存の `Sentry.logger` を使う。

```text
送信ロジック: apps/mobile/lib/events.ts          # trackEvent(name, attributes)
コンテキスト: apps/mobile/lib/useEventTrackingContext.ts
              # 現在画面・userId を module 状態へ同期（app/_layout.tsx で呼ぶ）
イベント名・属性キー: packages/observability/src/events.ts
レート制限: packages/observability/src/rateLimit.ts
```

### イベント命名

- イベント名は `<対象>_<動作>` の snake_case（例: `meishi_save`,
  `tier_share`, `watch_status_change`）。Sentry Logs の message と
  `event.name` 属性の両方に入る（logs では message での group-by が
  効かないため、集計軸として `event.name` を別途属性にも持たせる）。
- 名称は `TRACKED_EVENTS`（`packages/observability/src/events.ts`）に
  列挙して管理する。新しい計測を足すときはここに追加する。
- `annict_connect_funnel` は既存ダッシュボードとの互換のため
  命名・属性を変更しないまま同じ送信経路（`trackEvent`）へ乗せている
  （`autoAttributes: false` で自動属性を付けず、既存の属性セットを維持）。

### 属性

共通（`trackEvent` が自動付与、`autoAttributes: true` の場合）:

| 属性 | 値 |
|------|-----|
| `event.name` | イベント名（集計の group-by 軸） |
| `platform` | `ios` / `android` / `web` |
| `app_version` | `Constants.expoConfig.version`（未解決なら `dev`） |
| `screen` | 現在のルート（`useSegments` ベース。`/(tabs)` 等の group を除き `/` で連結。空なら `index`）。動的セグメントはルートパターンの `[uid]` 表記のままなので実値は載らない |
| `user_key` | Clerk userId のソルト付き SHA-256 先頭16文字。ソルトは Annict ファネルと同じで突き合わせ可能（PII は送らない） |

イベント固有（`TRACK_EVENT_KEYS` にキーを集約）:

| キー | 使うイベント | 値 |
|------|--------------|-----|
| `method` | `tier_share` | `url` / `image` / `x` / `copy` |
| `action` | `favorite_toggle` | `add` / `remove` |
| `from` / `to` | `watch_status_change` | `WATCHING` / `WATCHED` / `ON_HOLD` / `STOP_WATCHING` / `WANNA_WATCH` |
| `run_type` | `analysis_generate` | `initial` / `regenerate` |

送信しないもの（PII 方針は Annict ファネルと同じ）:
生の Clerk userId・プロフィール ID・共有 URL ・作品/キャラクター ID・
ユーザー入力テキスト・画像コンテンツ。`screen` は pathname ではなく
`useSegments` のルートパターンを使うため、`/user/xxx` のような
実値が載ることはない（防御としての仕組み。運用ルールだけに依存しない）。

### 計測する操作と発火点

| イベント | 発火点 |
|----------|--------|
| `qr_exchange_start` | `app/(tabs)/qr.tsx` のフォーカス時（名刺交換画面への進入） |
| `qr_scan_start` | スキャンが開始された時（「スキャン」タブへの切替、またはスキャン状態のままタブへ再訪。スキャン中の再タップは送らない） |
| `meishi_share` | マイ QR が表示された時（名刺の共有面。タブ再訪でも発火） |
| `meishi_save` | `app/meishi/edit.tsx` の保存ボタン |
| `tier_share_open` | Tier 表 / キャラクター Tier 表の「共有」ボタン |
| `tier_share` | 方式の選択時（native は options.native.ts の URL/画像選択、Web は共有モーダル内の X/コピー/画像ボタン。Web のモーダル表示自体では送らない） |
| `tier_image_generate` | Web 共有モーダルの「画像を生成」 |
| `tier_image_save` | Web 共有モーダルの「画像をダウンロード」 |
| `tier_work_add_open` | `TierBoard` の「＋ 追加」（作品検索シートを開く） |
| `tier_work_add` | 検索シートから作品を追加した時（実際に盤面へ載ったものだけ） |
| `character_tier_open` | アニメ一覧のキャラクター tier 表ボタン |
| `analysis_generate` | 「分析する / 再分析する」ボタン |
| `watch_status_change` | 視聴履歴の編集モーダル保存（`from` / `to` 付き。値が変わらない保存は送らない） |
| `favorite_toggle` | お気に入りトグル（`action` 付き。一覧画面・お気に入りタブの解除） |

原則「ユーザーが操作した」時点で送る（成否の結果ではなく操作の意図を
計測する）。`tier_work_add` のように「押下しても何も起きない」ケースが
あるものだけ、実際に効果があった時点で送る。

### レート制限

`EventRateLimiter`（`packages/observability/src/rateLimit.ts`）で
同一イベント名あたり **60 秒に 10 回**までに制限する
（既定値 `EVENT_RATE_LIMIT`）。連打・ループ・異常系で無料枠
（Developer プラン 5 GB/月、超過請求なしの上限設定）を使い切るのを防ぐ
ためのクライアント側の安全弁であり、上限到達分は静かに捨てる。
制限自体をイベント化しない（そのイベントも枠を消費するため）。

`annict_connect_funnel` も同じリミッターを通るが、全ステップが同一
イベント名を共有するため **`annict_connect_funnel:<step>` の
ステップ別キー**で制限する（`rateLimitKey` オプション）。
`prompt_view` の連打で上限に達しても `cta_tap` / `oauth_result` が
捨てられてファネルが壊れることを防ぐ。

### 新しい計測を追加する手順

1. `TRACKED_EVENTS` に `<対象>_<動作>` の snake_case でイベント名を追加する
2. 発火点で `trackEvent("<name>", { ...属性 })` を呼ぶ
   （fire-and-forget。await 不要。属性は enum 的な固定値のみ、
   PII・URL・ユーザー入力・ID は送らない）。
   - 画面進入直後のイベントはルートレイアウトの `screen` 同期が間に
     合わないことがあるため、`{ screen: "<ルートパターン>" }` を明示する
   - 同一イベント名で段階を分ける計測（ファネル等）は
     `{ rateLimitKey: "<name>:<step>" }` でステップ別枠にする
3. 必要なら `TRACK_EVENT_KEYS` に属性キーを追加する
4. `scripts/sentry/setup-ui-events-dashboard.sh` に該当ウィジェットを足す
   （既存ダッシュボードには自動反映されないため、Sentry 側で手動追加
   するか該当ウィジェットを削除してスクリプト再実行）

### ダッシュボード（再現手順）

UI イベント用の Sentry ダッシュボード「UI イベント計測」は
`scripts/sentry/setup-ui-events-dashboard.sh` で作成する（logs データセット。
イベント総数・日別推移（イベント別/画面別）・ボタン別回数・
画面 × イベント表・共有方式/ステータス遷移/お気に入り/AI 分析の内訳表）。

```bash
sentry auth login   # ダッシュボード作成・編集権限（org:write 相当）のあるアカウント/トークンで
bash scripts/sentry/setup-ui-events-dashboard.sh [org] [project]
```

冪等性とウィジェット更新の扱いは Annict 用スクリプトと同じ。
クエリのベースは `environment:production has:event.name`
（`event.name` 属性を持つ UI 計測イベントだけに絞るため、
`annict_connect_funnel` 等の他用途ログは混ざらない）。

## 残課題（スコープ外）

- API / Web の source map upload と release 関連付けの CI 組み込み
- EAS Update 時の source map アップロード自動化
- Annict / D1 / Clerk ごとの breadcrumb・タグの拡充
- `tracesSampleRate` を含む performance tracing
- `feature` タグの付与規則（route 単位の機能名）
- EAS Update の `expo-update-id` 等のタグ付け

## 実装時の確認事項

- `withSentry` が `scheduled` ハンドラをカバーするか
  （SDK の現行バージョンで確認。対象外なら個別 try/catch を追加）
- `wrangler dev` / vitest-pool-workers で `CF_VERSION_METADATA` が
  どう解決されるか（未提供なら `"dev"` フォールバックで十分）
- `observability` セクションの per-env 上書きが `wrangler deploy --env
  production` に正しく効くか
