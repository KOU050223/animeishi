# Animeishi デプロイ手順

API（`@animeishi/api`）と Web フロント（`@animeishi/mobile` の web エクスポート）を Cloudflare Workers にデプロイする手順と、必要な環境変数の登録方法をまとめる。

両アプリとも `main` への push で GitHub Actions が自動デプロイする（[`deploy-api.yml`](../.github/workflows/deploy-api.yml) / [`deploy-web.yml`](../.github/workflows/deploy-web.yml)）。Web フロントと API は PR ごとのプレビューデプロイも行う（[`preview-web.yml`](../.github/workflows/preview-web.yml) / [`preview-api.yml`](../.github/workflows/preview-api.yml)）。手動デプロイも可能。

## 構成概要

| アプリ | Worker 名 | デプロイ内容 | 設定ファイル |
| --- | --- | --- | --- |
| API | `animeishi-api-production` | Hono のサーバコード（D1 / R2 / Queue バインディング） | [`services/api/wrangler.toml`](../services/api/wrangler.toml) の `[env.production]` |
| API（プレビュー） | `animeishi-api-preview` | 同上。本番とは別の D1 / R2 / Queue を持つ | 同上の `[env.preview]` |
| Web | `animeishi-web-production` | Expo Router の web エクスポート（SPA 静的アセット） | [`apps/mobile/wrangler.toml`](../apps/mobile/wrangler.toml) |

## 環境変数の種類と登録先

環境変数は「**いつ・どこで読まれるか**」で登録先が変わる。混同するとビルドは通っても本番で値が空になる。

| 変数 | 読まれるタイミング | 登録先 | 秘匿性 |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Web の**ビルド時**にバンドルへ焼き込み | GitHub Actions **Variables** | 公開値（publishable） |
| `EXPO_PUBLIC_API_URL` | Web の**ビルド時**にバンドルへ焼き込み | GitHub Actions **Variables** | 公開値 |
| `EXPO_PUBLIC_PREVIEW_API_URL` | Web プレビューの**ビルド時**にバンドルへ焼き込み。未設定なら PR 番号から組み立てる `https://pr-<N>-animeishi-api-preview.<subdomain>.workers.dev` を使用 | GitHub Actions **Variables**（任意・上書き用） | 公開値 |
| `EXPO_PUBLIC_ANNICT_CLIENT_ID` | Web の**ビルド時**にバンドルへ焼き込み | GitHub Actions **Variables** | 公開値 |
| `CLOUDFLARE_WORKERS_SUBDOMAIN` | Web プレビュー URL のコメント生成に使用（未設定なら `uozumi05`） | GitHub Actions **Variables**（任意） | 公開値 |
| `CLOUDFLARE_API_TOKEN` | デプロイ時（wrangler 認証） | GitHub Actions **Secrets** | 秘密 |
| `CLERK_SECRET_KEY` | API の**ランタイム**（JWT 検証） | Cloudflare Workers **secret** | 秘密 |
| `CLERK_PUBLISHABLE_KEY` | API の**ランタイム** | Cloudflare Workers **secret**（または vars） | 公開値 |
| `ALLOWED_ORIGINS` | API の**ランタイム**（CORS 判定） | `wrangler.toml` の `vars`（本番） / `.dev.vars`（ローカル） | 公開値 |
| `SENTRY_DSN` | API の**ランタイム**（Sentry 初期化）。未設定なら SDK は no-op | Cloudflare Workers **secret** | 秘密 |

> `EXPO_PUBLIC_*` は Expo の仕様でクライアント JS に平文で埋め込まれる。秘匿性は成立しないため Secrets ではなく Variables を使う。Cloudflare 側の vars に入れても Web のビルドからは読めない点に注意（Web は assets-only でワーカーコードを持たないため）。

## 1. GitHub Actions の変数登録

リポジトリの **Settings → Secrets and variables → Actions** で登録する。

### Variables タブ（公開値）

| Name | Value 例 |
| --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_xxxxx`（Clerk Dashboard → API Keys → Publishable key） |
| `EXPO_PUBLIC_API_URL` | `https://animeishi-api.uomi.dev` |
| `EXPO_PUBLIC_PREVIEW_API_URL` | 通常は未登録でよい（未登録なら PR ごとの `pr-<N>-animeishi-api-preview.<subdomain>.workers.dev` が使われる）。プレビュー web を固定の別 API に向けたい場合のみ設定 |
| `EXPO_PUBLIC_ANNICT_CLIENT_ID` | Annict OAuth の Client ID |
| `CLOUDFLARE_WORKERS_SUBDOMAIN` | `uozumi05`（通常は未登録でよい） |

CLI でも登録できる（[gh CLI](https://cli.github.com/) 使用時）:

```bash
gh variable set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --body "pk_live_xxxxx"
gh variable set EXPO_PUBLIC_API_URL --body "https://animeishi-api.uomi.dev"
gh variable set EXPO_PUBLIC_ANNICT_CLIENT_ID --body "xxxxx"
```

### Secrets タブ（秘密値）

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens で発行（Workers の編集権限を付与） |

```bash
gh secret set CLOUDFLARE_API_TOKEN --body "xxxxx"
```

## 2. PR プレビューデプロイ

同一リポジトリ内の pull request で `apps/mobile/**` または `services/api/**` が変更されると、Web と API の両方のプレビューが作成される。両 workflow とも `wrangler versions upload --preview-alias pr-<PR番号>` を使うため、ライブデプロイ（本番・preview Worker の latest）自体は更新せず、PR ごとの preview URL だけを発行する。

| 対象 | workflow | デプロイ先 env | preview URL |
| --- | --- | --- | --- |
| Web | `preview-web.yml` | `animeishi-web` の `production` | `https://pr-<N>-animeishi-web-production.<subdomain>.workers.dev` |
| API | `preview-api.yml` | `animeishi-api` の `preview` | `https://pr-<N>-animeishi-api-preview.<subdomain>.workers.dev` |

Web プレビューのビルドには `EXPO_PUBLIC_API_URL` として上記の PR 用 API URL が埋め込まれる（`EXPO_PUBLIC_PREVIEW_API_URL` が設定されている場合はそちらが優先される）。これにより、API に新エンドポイントを追加する PR でも、マージ前にプレビュー web 上で動作確認できる。

`preview-api.yml` は `preview-web.yml` と同じ `paths` で起動する。Web プレビューが常に `pr-<N>` の API URL を参照するため、両者は必ず同じ PR で走る必要がある。

必要な権限と変数:

- `CLOUDFLARE_API_TOKEN`: Workers への version upload ができる API token。
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` / `EXPO_PUBLIC_ANNICT_CLIENT_ID`: Web build 用の公開値。
- `EXPO_PUBLIC_PREVIEW_API_URL`: プレビューだけ別 API に向ける場合のみ設定する。未設定なら `pr-<N>-animeishi-api-preview.<subdomain>.workers.dev` を使う。
- `CLOUDFLARE_WORKERS_SUBDOMAIN`: PR コメントに載せる URL を組み立てるための workers.dev サブドメイン。未設定でも `uozumi05` を使うため、現状は追加不要。

セキュリティ上、workflow は fork からの PR ではデプロイしない。fork PR の preview が必要な場合は、同一リポジトリ内のブランチへ取り込んでから PR を作り直す。

### API プレビュー環境（`env.preview`）の構成

`animeishi-api-preview` は本番とは別のリソースを持ち、PR コードからの書き込みが本番データに混入しないようにしている。

| リソース | 本番 | プレビュー |
| --- | --- | --- |
| D1 | `animeishi-db` | `animeishi-db-preview` |
| R2 | `animeishi-avatars` | `animeishi-avatars-preview` |
| Queue / DLQ | `animeishi-image-fallback` / `-dlq` | `animeishi-image-fallback-preview` / `-dlq-preview` |

cron トリガーは preview では無効化してある（`crons = []`）。Queue の consume は preview Worker のライブデプロイが担うため、PR の preview バージョンが enqueue したメッセージは preview Worker の最新デプロイ済みコードが処理する。

### preview D1 の制限（共有 DB）

`animeishi-db-preview` は全 PR で共有する。マイグレーションはファイル名単位で適用済み管理されるため、別々の PR の移行ファイルは両方とも適用される（スキーマは全 PR の和集合になる）。そのため以下の制限がある:

- 同時期の PR 同士が同じテーブル・カラムを変更する移行を持つ場合、後着 PR の `migrations apply` が SQL エラーで失敗し得る。この場合でも version upload は続行され、API プレビュー自体は発行される（新スキーマ依存のエンドポイントのみ動かない）。ワークフローには警告が出る。
- マージされなかった PR の移行も preview DB に残留する。

プレビュー DB を作り直したい場合:

```bash
cd services/api
pnpm exec wrangler d1 delete animeishi-db-preview   # 削除
pnpm exec wrangler d1 create animeishi-db-preview   # 再作成（新しい database_id を wrangler.toml の [env.preview] に反映）
task db:migrate:preview                             # マイグレーション再適用（ルートから実行）
```

### 初回ブートストラップ（完了済み・再作成時の記録）

preview 環境の初回セットアップは以下の手順で行う（初回のみ・再作成時のみ必要）。

```bash
cd services/api

# 1. プレビュー用リソースを作成し、wrangler.toml の [env.preview] に ID を反映
pnpm exec wrangler d1 create animeishi-db-preview
pnpm exec wrangler r2 bucket create animeishi-avatars-preview
pnpm exec wrangler queues create animeishi-image-fallback-preview
pnpm exec wrangler queues create animeishi-image-fallback-dlq-preview

# 2. preview Worker を初回デプロイ（bindings・queue consumer を登録）
pnpm exec wrangler deploy --env preview

# 3. preview D1 にマイグレーション適用
pnpm exec wrangler d1 migrations apply animeishi-db-preview --env preview --remote
# （またはルートから `task db:migrate:preview`）

# 4. preview Worker に secret を登録（値は本番と同じものを使う。
#    Clerk は preview web が同じインスタンスで発行した JWT を検証するため必須）
pnpm exec wrangler secret put CLERK_SECRET_KEY --env preview
pnpm exec wrangler secret put CLERK_PUBLISHABLE_KEY --env preview
pnpm exec wrangler secret put ANNICT_CLIENT_SECRET --env preview
pnpm exec wrangler secret put ANNICT_ENCRYPTION_KEY --env preview
```

secret は Worker 単位の設定のため、一度登録すれば以後の `versions upload` / `deploy` で失われない（新しい version は前の version の secret を引き継ぐ）。

> `wrangler secret put` は「最新 version がデプロイ済み」でないと失敗する。CI が `versions upload` した version が最新のまま残るこの環境では、実行前に `pnpm exec wrangler deploy --env preview` で最新 version をデプロイするか、デプロイを伴わない `pnpm exec wrangler versions secret put <KEY> --env preview` を使う。

## 3. Cloudflare Workers の secret 登録（API ランタイム）

API が JWT 検証に使う Clerk のキーは Workers の secret として登録する。`services/api/` で実行する。

```bash
cd services/api

# 本番環境（--env production）に登録する
pnpm exec wrangler secret put CLERK_SECRET_KEY --env production
pnpm exec wrangler secret put CLERK_PUBLISHABLE_KEY --env production

# Sentry（API のエラー収集）。preview は同一プロジェクトの DSN を入れ、
# environment タグで分離する。詳細は「7. Sentry / Discord 通知」を参照
pnpm exec wrangler secret put SENTRY_DSN --env production
pnpm exec wrangler secret put SENTRY_DSN --env preview
```

実行するとプロンプトで値の入力を求められる。ローカル開発時は `services/api/.dev.vars` に記述する（[`.dev.vars.example`](../services/api/.dev.vars.example) 参照）。

## 4. CORS（`ALLOWED_ORIGINS`）の設定

API は `ALLOWED_ORIGINS`（カンマ区切り）に一致するオリジンのみ CORS を許可する（判定ロジックは [`services/api/src/cors.ts`](../services/api/src/cors.ts)）。未設定なら全許可（開発用）。

各エントリは 2 形式を取れる:

- **完全一致**: `https://animeishi.uomi.dev` のように、スキーム・ホスト・ポートまで含めて厳密一致。
- **ワイルドカード**: `*-animeishi-web-production.uozumi05.workers.dev` のように先頭 `*` を任意文字列として、残りのサフィックスに末尾一致。Cloudflare のプレビューデプロイ（`<hash>-<worker>.<subdomain>.workers.dev`）を許可する用途。

> `Origin` ヘッダはスキームとポート込みで送られる。`localhost` 単体やドメインだけでは一致しない（Expo web のデフォルトは `http://localhost:8081`）。

Web フロントを別ドメインから配信するため、**本番では Web のオリジンを必ず設定する**。設定しないと全許可のままになり、設定し忘れて空文字を入れると全ブロックになる点に注意。

`services/api/wrangler.toml` の `[env.production.vars]` に設定済み（現状の値）:

```toml
[env.production.vars]
ENVIRONMENT = "production"
ALLOWED_ORIGINS = "https://animeishi-web-production.uozumi05.workers.dev,*-animeishi-web-production.uozumi05.workers.dev,https://animeishi.uomi.dev,http://localhost:8081"
```

| オリジン | 用途 |
| --- | --- |
| `https://animeishi-web-production.uozumi05.workers.dev` | 本番 Web（`*.workers.dev`） |
| `*-animeishi-web-production.uozumi05.workers.dev` | プレビューデプロイ（ワイルドカード） |
| `https://animeishi.uomi.dev` | 独自ドメイン（割り当て予定） |
| `http://localhost:8081` | ローカル開発（Expo web） |

変更後は API を再デプロイする（`pnpm --filter @animeishi/api exec wrangler deploy --env production`）。ローカル開発で別の値を試す場合は `services/api/.dev.vars` に記述する。

## 5. 手動デプロイ

GitHub Actions を待たずにデプロイする場合:

```bash
# Web
pnpm --filter @animeishi/mobile build:web
pnpm --filter @animeishi/mobile deploy:web

# API
pnpm --filter @animeishi/api exec wrangler deploy --env production
```

事前に `wrangler login` でローカル認証を済ませておくこと。

## 6. ネイティブアプリの EAS Build

iOS / Android のネイティブビルドは EAS Build で行う。設定は [`apps/mobile/eas.json`](../apps/mobile/eas.json) と `app.json`（`extra.eas.projectId` / `updates.url` / `runtimeVersion`）に置く。`eas` コマンドは `apps/mobile` ディレクトリで実行する。

```bash
cd apps/mobile
pnpm exec eas build --profile production --platform ios
pnpm exec eas submit --profile production --platform ios
```

### EXPO_PUBLIC_* の渡し方

EAS Build は gitignore された `.env` をアップロードしないため、ローカルの `.env` はビルドに届かない。`EXPO_PUBLIC_*` はクライアントに埋め込まれる公開値なので、`eas.json` の各プロファイルの `env` に直接書く。

`preview` / `production` には API / Web の URL を設定済みだが、以下は `REPLACE_WITH_*` プレースホルダのままなので、初回ビルド前に実値で置き換えること（GitHub Actions の同名 Variables と同じ値）。

| 変数 | 値の入手先 |
| --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk Dashboard → API Keys → Publishable key（`pk_live_*`） |
| `EXPO_PUBLIC_ANNICT_CLIENT_ID` | Annict OAuth の Client ID |

プレースホルダのままビルドすると、起動時に「Clerk publishable key が設定されていません」で止まる。

`development` プロファイル（development build）に `env` は不要。実行時の JS はローカルの Metro から配信され、ローカルの `.env` が使われるため。

## 7. Sentry / Discord 通知

API Workers は `@sentry/cloudflare` で例外を Sentry へ送る
（設計は `docs/08_observability-design.md`）。`SENTRY_DSN` 未設定の
環境では SDK は no-op になる。通知はアプリケーションから直接飛ばさず、
Sentry Alert から Discord へ送る。

### 初期設定

1. Sentry でプロジェクト `animeishi-api` を作成し、DSN を取得する
2. `SENTRY_DSN` を Workers secret として登録する（本番・preview 両方。
   同一プロジェクトを使い、`environment` タグで分離する）
3. Sentry の Settings → Integrations で Discord を連携する
4. Alert rule を作成する。条件は `environment equals production` の
   `a new issue is created`（必要なら `issue changes state from
   resolved to regressed` も追加）、アクションは Discord チャンネル
   への通知とする

### 運用

- preview / development のイベントは同一プロジェクトに入るが、
  Alert 条件で通知対象外にしている。ノイズが多い場合は Alert 側の
  条件を絞る
- `wrangler tail` や Workers Logs（ダッシュボードの Observability）
  での短期調査は従来どおり使える。invocation logs は production のみ有効

## チェックリスト（初回デプロイ前）

- [ ] GitHub Variables に `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` / `EXPO_PUBLIC_API_URL` を登録
- [ ] GitHub Variables に `EXPO_PUBLIC_ANNICT_CLIENT_ID` を登録
- [ ] GitHub Secrets に `CLOUDFLARE_API_TOKEN` を登録
- [ ] Workers secret に `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` を登録（API 本番・preview 両方。preview への登録は「[初回ブートストラップ](#初回ブートストラップ完了済み再作成時の記録)」参照）
- [ ] Sentry プロジェクト `animeishi-api` を作成し、Workers secret に `SENTRY_DSN` を登録（本番・preview 両方）と Discord Alert を設定（「[7. Sentry / Discord 通知](#7-sentry--discord-通知)」参照）
- [ ] Web のドメイン確定後、API の `ALLOWED_ORIGINS` に Web オリジンを設定して再デプロイ
- [ ] `eas.json` の `env` と `submit` の `REPLACE_WITH_*` を実値で置き換える（ネイティブ初回ビルド前）
