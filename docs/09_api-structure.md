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
    openapi.ts                # OpenAPI 基盤（共通スキーマ・/doc /ui 登録。issue #14）
  test-utils/                 # テスト基盤
  features/
    <domain>/                 # 機能単位のディレクトリ（例: tier-lists, works, me）
      index.ts                # ルート定義 + ハンドラ（Hono RPC チェーンをここに置く）
      index.test.ts           # ルートのテスト（vitest・D1 実体）
      schema.ts               # zod スキーマ + createRoute 定義
      service.ts              # 純粋ロジック・外部連携・HTML 生成など（ある機能のみ）
      repository.ts           # DB アクセス層（ある機能のみ）
      repository.test.ts      # リポジトリのテスト
```

## 層の責務

```
HTTP リクエスト
   │
   ▼
index.ts (route/handler)   … createRoute(schema) の .openapi で入力検証、
   │                          認証ミドルウェア、レスポンス組み立て。
   │                          Hono RPC の型はここから推論される
   ├── schema.ts            … zod スキーマと createRoute 定義
   │                          （OpenAPI 化は issue #14、段階移行中。後述）
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

## OpenAPI 統合（issue #14）

`@hono/zod-openapi` + `@hono/swagger-ui` を導入し、OpenAPI ドキュメントを
`createRoute` 定義から自動生成する。Hono RPC の型（`AppType`）は
`.openapi(route, handler)` のチェーンから従来どおり推論される
（`{id}` 記法のパスは型レベルで `:id` に変換される）。

- ルート app と OpenAPI 対応済み feature のサブ app は `OpenAPIHono`。
  `.route()` でマウントすると、サブ app が登録したルート定義が親の
  `openAPIRegistry` にマージされて /doc に載る（素の Hono のままの
  feature は /doc に出ないだけで動作は従来どおり）
- 共通基盤は `src/lib/openapi.ts`：`bearerAuth`（security 要件）、
  `errorResponseSchema` / `successResponseSchema`（共通応答形）、
  `openapiValidationHook`（入力エラーを `{error: message}` の 400 に揃える
  `defaultHook`）、`registerOpenApiDocs`（/doc・/ui の登録）
- `GET /doc` … OpenAPI JSON、`GET /ui` … Swagger UI。
  本番を含む全環境で公開する。ドキュメントの閲覧に認証は不要だが、
  `security: bearerAuth` を付けた API の実行には従来どおり Clerk JWT が
  必要（公開されるのは API 仕様のみ）。/doc・/ui 自体は RPC クライアントの
  対象外なので `AppType` に含めない（`createRoute` ではなく素の
  `app.get` で登録）

### OpenAPI 化時の注意

- `createRoute` のパスは `{id}` 記法。パスパラメータは文字列のまま受け、
  数値化などの判定は従来どおりハンドラ側で行う
- JSON body を宣言したルートは、宣言と異なる Content-Type のリクエストに
  415 を返す（zod-openapi の mediaTypeGate）。画像バイナリ（image/*）は
  対象外なので Content-Type の検査は従来どおりハンドラ側で行う
- レスポンススキーマは `InferResponseType` を使う mobile 側の型にも効く。
  実際のハンドラ応答と一致させること（型チェックで検証される）

### 移行状況（段階移行）

OpenAPI 化済み（/doc に掲載される）:
- `health` / `users`（report・block）/ `favorites` / `friends` /
  `me`（profile・blocks・avatar 投稿・meishi-assets 投稿・アカウント削除）

未移行（素の Hono のまま。動作に影響なし、/doc には出ない）:
- `share` / `images` / `user` / `annict` / `import` / `watch-histories` /
  `works` / `pass` / `tier-lists` / `character-tier-lists` /
  `me` の画像配信サブ app（`avatar`・`meishiAssets`。`/*` のワイルドカード
  配信で OpenAPI 化の優先度が低い）

ルートを追加・変更する feature は、対象ルートの createRoute 化を優先する。

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
