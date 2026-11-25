# API 契約（packages/api-contract）

API の仕様を mobile とレビュー用の生成物に配るパッケージ（issue #725）。
生成物は用途の違う 2 系統ある。

- `openapi.json` / `schema.d.ts` … OpenAPI 仕様と、そこから生成した型。
  変更内容をレビューしやすくするため、どちらもコミットする
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

`generated/rpcSchema.d.ts` はコミットしない。TypeScript 7 の宣言出力では
union 型の並び順が実行ごとに変わることがあり、同じソースからでも差分が出る
ためである。`packages/api-contract/generated/` は `.gitignore` と
`.oxfmtignore` で除外している。

`vp install` では prepare から typegen を実行する。新しい worktree を作った
直後でも、エディタが `@animeishi/api-contract/rpc` を解決できる。API のルート
やスキーマを変えたあとエディタの型を更新したいときは、上の typegen コマンドを
実行する。mobile の typecheck・lint・test・dev は typegen に依存するため、
`vp run` 経由では生成物がなくても先に生成・復元される。

生成時に API 側で `TS4023` / `TS7056` が出たときは、宣言ファイルに展開できない
型が公開型へ漏れている。GraphQL のクライアント型のように RPC の入出力に不要な
ものは `@internal` を付けて `stripInternal` で落とし、RPC の入出力に必要なものは
明示的な型注釈を付ける。

## OpenAPI 仕様の再生成と整合チェック

```bash
vp run @animeishi/api-contract#generate   # openapi.json / schema.d.ts を書き直す
vp run @animeishi/api-contract#check      # API の定義から再生成して差分があれば失敗
```

API のルート・スキーマを変えたら generate して両ファイルをコミットする。
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

## このパッケージだけ typescript@5.9.3 を持つ

openapi-typescript（型生成に使う JS API）が peer に `typescript@^5` を要求
するため、実 devDependency として 5.9.3 を入れている。副作用としてこの
パッケージの `node_modules/.bin/tsc` は TypeScript 5 を指すので、
typecheck タスクと typegen はワークスペースと同じ TypeScript 7
（`@typescript/native`）をルートの .bin 経由で明示している
（packages/api-contract/vite.config.ts、scripts/typegen.mts）。
openapi-typescript が TypeScript 6/7 対応をリリースしたら 5.9.3 を外せる。
