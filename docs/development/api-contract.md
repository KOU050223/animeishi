# API 契約（packages/api-contract）

API の OpenAPI 仕様と、それから生成した型をコミット済みファイルとして持つ
パッケージ（issue #725 段階②）。

- `openapi.json` … `@animeishi/api` の OpenAPIHono から
  `getOpenAPI31Document()` で書き出した OpenAPI 3.1 ドキュメント
- `schema.d.ts` … openapi.json を openapi-typescript で型化したもの。
  パッケージの `exports` / `types` が指す実体で、消費側は
  `import type { paths } from "@animeishi/api-contract"` で使う
  （mobile の openapi-fetch クライアントは `apps/mobile/lib/openapiClient.ts`）

## 再生成と整合チェック

```bash
vp run @animeishi/api-contract#generate   # openapi.json / schema.d.ts を書き直す
vp run @animeishi/api-contract#check      # API の定義から再生成して差分があれば失敗
```

API のルート・スキーマを変えたら generate して両ファイルをコミットする。
`check` は CI の Lint & Type Check ジョブで走り、生成物のずれを検出する。

生成は tsx で `scripts/generate.mts` を実行する。`@animeishi/api` の
`src/index.ts` ではなく `src/app.ts` から `routes` を読むのは、index が
Sentry・Workflows 経由で `cloudflare:*` モジュールを import する Worker
エントリであり、Node 上では評価できないため。API のルート組み立てを変えたら
この分離が追従するか確認する。

## API 内部の `@/` の解決

API のソースは内部 import に `@/`（apps/api/tsconfig.json の `paths`）を
使う。スクリプトは tsx で動き、tsx はこのパッケージの tsconfig で specifier
を解決するため、packages/api-contract/tsconfig.json にも
`"@/*": ["../../apps/api/src/*"]` を持たせて API の import 表記は
変えずに解決している。同じ paths が typecheck タスク（tsc）にも効く。

mobile の tsconfig の `@/*` が持つ `../../apps/api/src/*` へのフォールバック
（`AppType` 経由で API ソースを読むためのもの）は段階②では残し、段階④で
`AppType` 参照を消すときに一緒に外す（issue #725）。

## このパッケージだけ typescript@5.9.3 を持つ

openapi-typescript（型生成に使う JS API）が peer に `typescript@^5` を要求
するため、実 devDependency として 5.9.3 を入れている。副作用としてこの
パッケージの `node_modules/.bin/tsc` は TypeScript 5 を指すので、
typecheck タスクはワークスペースと同じ TypeScript 7（`@typescript/native`）
をルートの .bin 経由で明示している（packages/api-contract/vite.config.ts）。
openapi-typescript が TypeScript 6/7 対応をリリースしたら 5.9.3 を外せる。
