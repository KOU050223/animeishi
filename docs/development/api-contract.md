# API 契約（packages/api-contract）

API の仕様を mobile とレビュー用の生成物に配るパッケージ（issue #725）。
生成物は用途の違う 2 系統ある。

- `openapi.json` … OpenAPI 仕様。変更内容をレビューしやすくするためコミットする
- `generated/rpcSchema.d.ts` … Hono RPC のルート型（`ExtractSchema`）を
  事前に展開した宣言ファイル。mobile は `@animeishi/api-contract/rpc`
  からこの型だけを読み、API のソースを型チェックの入力にしない

## Hono RPC の型生成

```bash
vp run @animeishi/api-contract#typegen   # generated/rpcSchema.d.ts を生成・更新する
```

typegen は apps/api/src/rpcSchema.ts を入口に TypeScript 7 で
`tsc --emitDeclarationOnly` を実行する。`ExtractSchema<typeof routes>` を展開
させた宣言だけを出力するため、生成物が参照する外部モジュールは hono だけであり、
API 内部ソースや Workers 固有の型は参照しない。

typegen では `tsc` に `--noCheck` を付け、型エラーの検査を API 自身の typecheck
に任せる。prepare からも実行されるため、ここで型エラーにすると API の型エラーが
残っている状態で `vp install` 自体が失敗する。

`generated/rpcSchema.d.ts` はコミットしない。TypeScript 7 の宣言出力では
union 型の並び順が実行ごとに変わることがあり、同じソースからでも差分が出る
ためである。`packages/api-contract/generated/` は `.gitignore` と
`.oxfmtignore` で除外している。

`vp install` では prepare から typegen を実行する。新しい worktree を作った
直後でも、エディタが `@animeishi/api-contract/rpc` を解決できる。ブランチの
切り替え後は post-checkout、merge 後は post-merge、rebase 後は post-rewrite の
Git フックが typegen を実行する。依存をインストールしていない worktree では
何もせず、typegen が失敗しても警告だけを出して Git 操作は成功する。競合を
解消して `git merge --continue` で終えた merge では post-merge が走らないため、
API が変わったときは上の typegen コマンドを手で実行する。

Claude Code 等のエージェントが API を編集した直後など、Git 操作を挟まずに
エディタの型を更新したいときは、上の typegen コマンドを手で実行する。mobile の
typecheck・lint・test・dev は typegen に依存するため、`vp run` 経由では生成物が
なくても先に生成・復元される。

生成時に API 側で `TS4023` / `TS7056` が出たときは、宣言ファイルに展開できない
型が公開型へ漏れている。GraphQL のクライアント型のように RPC の入出力に不要な
ものは `@internal` を付けて `stripInternal` で落とし、RPC の入出力に必要なものは
明示的な型注釈を付ける。

## OpenAPI 仕様の再生成と整合チェック

```bash
vp run @animeishi/api-contract#generate   # openapi.json を書き直す
vp run @animeishi/api-contract#check      # API の定義から再生成して差分があれば失敗
```

API のルート・スキーマを変えたら generate して openapi.json をコミットする。
`check` は CI の Lint & Type Check ジョブで走り、コミット済みの OpenAPI 生成物の
ずれを検出する。Hono RPC 用の `generated/rpcSchema.d.ts` はコミットしないため、
`check` の対象ではない。

OpenAPI の生成は tsx で `scripts/generate.mts` を実行する。`@animeishi/api` の
`src/index.ts` ではなく `src/app.ts` から `routes` を読むのは、index が
Sentry・Workflows 経由で `cloudflare:*` モジュールを import する Worker
エントリであり、Node 上では評価できないため。API のルート組み立てを変えたら
この分離が追従するか確認する。

## API 内部の `@/` の解決

API のソースは内部 import に `@/`（apps/api/tsconfig.json の `paths`）を
使う。OpenAPI 生成スクリプトは tsx で動き、tsx はこのパッケージの tsconfig で
specifier を解決するため、packages/api-contract/tsconfig.json にも
`"@/*": ["../../apps/api/src/*"]` を持たせて API の import 表記は
変えずに解決している。同じ paths がこのパッケージの typecheck タスク（tsc）
にも効く。

mobile 側の `@/*` は apps/mobile 内だけを指す。mobile が Hono RPC の型を通じて
読むのは生成済みの `rpcSchema.d.ts` だけであり、apps/api/src への paths は
持たない。`apps/mobile/worker/` は Workers 固有の型を使うため、
`worker/tsconfig.json` にだけ `@cloudflare/workers-types` を持たせて別に
型チェックする。

## エラー応答の約束（issue #838）

API のエラー応答はすべて次の形を返す。

```json
{ "error": "Work not found", "code": "work_not_found" }
```

- `code` … 機械が読む識別子。snake_case。省略しない（必須）。
  クライアントが文言や挙動を分けるために使う。既存の code
  （`annict_token_required` など）の名前は変えない
- `error` … 開発者向けの英語メッセージ。利用者の画面には出さない
  （かつて日本語の利用者向け文言を入れていたが、表示文言の翻訳は
  クライアント側で行うため英語に統一した）
- 429 では `Retry-After` ヘッダ（秒数）を返し、OpenAPI のスキーマにも
  ヘッダを宣言する。Annict 上流のエラー（429 / 502 / 503）も同じ形で、
  code（`annict_rate_limited` / `annict_upstream` /
  `annict_shared_token_unavailable` 等）をスキーマに宣言する

スキーマは `apps/api/src/lib/openapi.ts` の `errorResponseSchema` が
`{ error, code }` を必須で持ち、各ルートはそれを使ってレスポンスを
宣言する。特定の code だけを返すレスポンスは `code` を enum / literal
で絞って宣言する。ミドルウェア（認証・流量制限・バリデーション失敗の
`invalid_request`・未処理例外の `internal_error`）も同じ形で返す。

クライアント（mobile）の扱い:

- サーバーの `error` は画面に出さない。表示文言は `code` から
  `apps/mobile/lib/apiErrorMessages.ts` の対応表で翻訳キーを引き、
  i18n（ja / en）で表示する
- 対応表に無い（未知の）code は、呼び出し側に従来からある汎用文言へ
  フォールバックする
- 429 の再試行タイミングが必要なら `Retry-After` を読む
  （`readRetryAfterSeconds`）。`ApiRequestError` に code と秒数が乗る
