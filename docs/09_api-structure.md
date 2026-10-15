# 09. API のファイル構成（services/api）

Issue: https://github.com/KOU050223/animeishi/issues/78
参考: https://zenn.dev/ashunar0/articles/1ba94a110d8622

## 目的

`services/api` を Hono の推奨構成に沿って機能単位（feature）のディレクトリに
再編し、routes / schema / repository / service の責務を分離する。
巨大化していた `repository/authorizedDb.ts`（約1800行）の解体が中心課題。

API のパス・レスポンス・Hono RPC の型（`AppType` → apps/mobile の
`apiClient` 型推論）は一切変更しない。

## 全体構成

```
services/api/src/
  index.ts                    # app 組み立て・ルート mount（順序は挙動に影響するため固定）
  observability.ts            # Sentry / onError
  middleware/                 # 認証など横断ミドルウェア
  db/                         # schema・D1 クライアント
  lib/                        # 外部 API クライアント等のドメイン非依存ユーティリティ
  test-utils/                 # テスト基盤
  features/
    <domain>/                 # 機能単位のディレクトリ（例: tier-lists, works, me）
      index.ts                # ルート定義 + ハンドラ（Hono RPC チェーンをここに置く）
      index.test.ts           # ルートのテスト（vitest・D1 実体）
      schema.ts               # zod スキーマ（zValidator 入力）
      service.ts              # 純粋ロジック・外部連携・HTML 生成など（ある機能のみ）
      repository.ts           # DB アクセス層（ある機能のみ）
      repository.test.ts      # リポジトリのテスト
```

## 層の責務

```
HTTP リクエスト
   │
   ▼
index.ts (route/handler)   … zValidator(schema) で入力検証、認証ミドルウェア、
   │                          レスポンス組み立て。Hono RPC の型はここから推論される
   ├── schema.ts            … zod スキーマのみ。@hono/zod-openapi 化（issue #14）
   │                          の際はここを openAPIRoute 化する想定
   ├── service.ts           … 外部 API 連携・純粋関数・HTML 生成などの
   │                          振る舞いロジック。DB 参照が必要な場合は
   │                          repository 経由で行う（直接 db.insert 等は禁止）
   └── repository.ts        … Drizzle/D1 へのクエリを集約。
                              ユーザー束縛ファクトリ: xxxRepository(db, userId)
                              ユーザー非束縛（共有カタログ）: worksRepository(db)
```

### リポジトリの分割方針

旧 `repository/authorizedDb.ts` は「認証ユーザーを束縛した全テーブルの窓口」
だったが、ドメインごとに分割した。

| 旧セクション | 新しい置き場所 |
|---|---|
| Profile / Tombstone / Genres / Blocks / Reports / Account削除 | `features/users/repository.ts` |
| Annict Token | `features/annict/repository.ts` |
| Watch History（sync 含む） | `features/watch-history/repository.ts` |
| Favorites | `features/favorites/repository.ts` |
| Friends | `features/friends/repository.ts` |
| Tier Lists | `features/tier-lists/repository.ts` |
| Character Tier Lists | `features/character-tier-lists/repository.ts` |
| annict_works / annict_characters（全ユーザー共有カタログ） | `features/works/repository.ts` |
| sharedTierLists.ts（公開共有リンク参照） | `features/share/repository.ts` |

`works` は「作品カタログ」という共有リソースなので、他 feature のリポジトリ・
ミドルウェア・cron（`lib/annict/imagePrefetch` 等）からも import される。
ユーザー束縛リポジトリからは `worksRepository(db)` を別途生成して使う
（例: watch-history が作品メタを upsert する場合）。

## ルール

- `db.insert` / `db.update` / `db.delete` は `features/*/repository.ts` と
  テスト・test-utils 以外では禁止（`.oxlintrc.json` の
  `no-restricted-properties` で強制）
- feature 間の参照は他 feature の `repository.ts` / `service.ts` を
  import する。schema の共有は最小限にとどめ、必要なら
  `lib/` または直接他 feature の `schema.ts` を import する
- `index.ts` のルート mount 順は認証の適用範囲に影響するため、並び替えは
  挙動変更として扱う
- Hono RPC の型互換を守るため、ルートチェーン（`new Hono().get(...)` 等）は
  `index.ts` に直接記述し、`export type` 推論が途切れる中間変数を挟まない

## 旧構成からの対応

| 旧パス | 新パス |
|---|---|
| `src/routes/<name>.ts` | `src/features/<name>/index.ts` |
| `src/routes/<name>.test.ts` | `src/features/<name>/index.test.ts` |
| `src/routes/watch-history-bulk.test.ts` | `src/features/watch-history/bulk.test.ts` |
| `src/schema/validators.ts` | `src/features/*/schema.ts` に分散 |
| `ANNICT_STATUS_STATES`（validators 内） | `src/lib/annict/statusState.ts` |
| `src/repository/authorizedDb.ts` | `src/features/*/repository.ts` に分散 |
| `src/repository/sharedTierLists.ts` | `src/features/share/repository.ts` |
