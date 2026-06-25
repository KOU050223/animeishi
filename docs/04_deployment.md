# Animeishi デプロイ手順

API（`@animeishi/api`）と Web フロント（`@animeishi/mobile` の web エクスポート）を Cloudflare Workers にデプロイする手順と、必要な環境変数の登録方法をまとめる。

両アプリとも `main` への push で GitHub Actions が自動デプロイする（[`deploy-api.yml`](../.github/workflows/deploy-api.yml) / [`deploy-web.yml`](../.github/workflows/deploy-web.yml)）。手動デプロイも可能。

## 構成概要

| アプリ | Worker 名 | デプロイ内容 | 設定ファイル |
| --- | --- | --- | --- |
| API | `animeishi-api` | Hono のサーバコード（D1 / R2 バインディング） | [`services/api/wrangler.toml`](../services/api/wrangler.toml) |
| Web | `animeishi-web` | Expo Router の web エクスポート（SPA 静的アセット） | [`apps/mobile/wrangler.toml`](../apps/mobile/wrangler.toml) |

## 環境変数の種類と登録先

環境変数は「**いつ・どこで読まれるか**」で登録先が変わる。混同するとビルドは通っても本番で値が空になる。

| 変数 | 読まれるタイミング | 登録先 | 秘匿性 |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Web の**ビルド時**にバンドルへ焼き込み | GitHub Actions **Variables** | 公開値（publishable） |
| `EXPO_PUBLIC_API_URL` | Web の**ビルド時**にバンドルへ焼き込み | GitHub Actions **Variables** | 公開値 |
| `CLOUDFLARE_API_TOKEN` | デプロイ時（wrangler 認証） | GitHub Actions **Secrets** | 秘密 |
| `CLERK_SECRET_KEY` | API の**ランタイム**（JWT 検証） | Cloudflare Workers **secret** | 秘密 |
| `CLERK_PUBLISHABLE_KEY` | API の**ランタイム** | Cloudflare Workers **secret**（または vars） | 公開値 |
| `ALLOWED_ORIGINS` | API の**ランタイム**（CORS 判定） | `wrangler.toml` の `vars`（本番） / `.dev.vars`（ローカル） | 公開値 |

> `EXPO_PUBLIC_*` は Expo の仕様でクライアント JS に平文で埋め込まれる。秘匿性は成立しないため Secrets ではなく Variables を使う。Cloudflare 側の vars に入れても Web のビルドからは読めない点に注意（Web は assets-only でワーカーコードを持たないため）。

## 1. GitHub Actions の変数登録

リポジトリの **Settings → Secrets and variables → Actions** で登録する。

### Variables タブ（公開値）

| Name | Value 例 |
| --- | --- |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_xxxxx`（Clerk Dashboard → API Keys → Publishable key） |
| `EXPO_PUBLIC_API_URL` | `https://animeishi-api.uomi.dev` |

CLI でも登録できる（[gh CLI](https://cli.github.com/) 使用時）:

```bash
gh variable set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY --body "pk_live_xxxxx"
gh variable set EXPO_PUBLIC_API_URL --body "https://animeishi-api.uomi.dev"
```

### Secrets タブ（秘密値）

| Name | Value |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare Dashboard → My Profile → API Tokens で発行（Workers の編集権限を付与） |

```bash
gh secret set CLOUDFLARE_API_TOKEN --body "xxxxx"
```

## 2. Cloudflare Workers の secret 登録（API ランタイム）

API が JWT 検証に使う Clerk のキーは Workers の secret として登録する。`services/api/` で実行する。

```bash
cd services/api

# 本番環境（--env production）に登録する
pnpm exec wrangler secret put CLERK_SECRET_KEY --env production
pnpm exec wrangler secret put CLERK_PUBLISHABLE_KEY --env production
```

実行するとプロンプトで値の入力を求められる。ローカル開発時は `services/api/.dev.vars` に記述する（[`.dev.vars.example`](../services/api/.dev.vars.example) 参照）。

## 3. CORS（`ALLOWED_ORIGINS`）の設定

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

## 4. 手動デプロイ

GitHub Actions を待たずにデプロイする場合:

```bash
# Web
pnpm --filter @animeishi/mobile build:web
pnpm --filter @animeishi/mobile deploy:web

# API
pnpm --filter @animeishi/api exec wrangler deploy --env production
```

事前に `wrangler login` でローカル認証を済ませておくこと。

## チェックリスト（初回デプロイ前）

- [ ] GitHub Variables に `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` / `EXPO_PUBLIC_API_URL` を登録
- [ ] GitHub Secrets に `CLOUDFLARE_API_TOKEN` を登録
- [ ] Workers secret に `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` を登録（API）
- [ ] Web のドメイン確定後、API の `ALLOWED_ORIGINS` に Web オリジンを設定して再デプロイ
