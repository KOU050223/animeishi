# PR 2 受け入れ基準: Hono API基盤とD1/Drizzleセットアップ

## 概要

`services/api` の初期化、D1ローカル環境構築、DrizzleによるDBスキーマ定義、authorizedDb（リポジトリ層）の作成、直接DB更新禁止のESLintルール追加。

クライアント-サーバー間通信は **HonoRPC**（`hono/client`）を採用する。PR 2 ではその土台として、ルートチェーンを `routes` 変数に束縛し `AppType` を export できる構造にしておく。

---

## 受け入れ基準

### AC-1: Hono APIサーバーが起動する

- [ ] `pnpm --filter @animeishi/api dev` を実行するとWranglerがローカルで起動する
- [ ] `GET /health` が `{ status: "ok" }` を返す

### AC-1b: HonoRPC 用の AppType が export されている

- [ ] `services/api/src/index.ts` でルートがチェーン変数（`routes`）として定義されている
- [ ] `export type AppType = typeof routes` が存在し、`tsc --noEmit` でエラーが出ない
- [ ] PR 3 以降で `packages/contracts` が `AppType` を re-export できる構造になっている

### AC-2: DrizzleスキーマがD1に対応している

- [ ] `src/db/schema.ts` に以下のテーブルが定義されている
  - `users`
  - `anime_titles`
  - `watch_history`
  - `favorites`
  - `friends`
  - `user_genres`
- [ ] `pnpm --filter @animeishi/api db:generate` でマイグレーションSQLが生成される
- [ ] `pnpm --filter @animeishi/api db:migrate:local` でローカルD1にマイグレーションが適用される

### AC-3: authorizedDb（リポジトリ層）が正しく動作する

- [ ] `authorizedDb(db, userId)` は `currentUserId` に束縛されたDBアクセスオブジェクトを返す
- [ ] プロフィールCRUDが正しく動作する
- [ ] 視聴履歴のupsert・削除が正しく動作する
- [ ] お気に入りの追加・削除が正しく動作する
- [ ] フレンド追加が正しく動作し、自己フレンドはエラーになる
- [ ] ジャンルの設定・取得・上書きが正しく動作する
- [ ] 各メソッドは **自分のデータにしかアクセスしない**（スコープ分離）

### AC-4: 直接DB更新を禁止するESLintルールが機能する

- [ ] `eslint-rules/no-direct-db.js` が定義されている
- [ ] リポジトリ層以外のファイルで `db.insert()` / `db.update()` / `db.delete()` を呼ぶとESLintエラーになる
- [ ] リポジトリ層（`repository/` 配下）は例外として許可される

### AC-5: テストがすべて通る

- [ ] `pnpm --filter @animeishi/api test` でVitestが実行される
- [ ] authorizedDb の全テストがGREENになる
  - プロフィール取得・更新・スコープ分離
  - 視聴履歴の追加・upsert・他ユーザー分離・削除
  - お気に入りの追加・重複排除・削除
  - フレンド追加・自己フレンドのバリデーション
  - ジャンルの設定・上書き
  - アニメタイトルの一覧・ID検索

### AC-6: TypeScriptのビルドエラーがない

- [ ] `pnpm --filter @animeishi/api build` でビルドが通る（`tsc --noEmit`）
