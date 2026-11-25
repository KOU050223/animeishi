# knip（未使用コード・依存の検出）

リポジトリ内の未使用ファイル・export・依存を検出する仕組みを変えるとき、
検出結果への対処方針を確認するときに読む（issue #738）。

## 実行方法

```bash
vp run knip    # リポジトリ全体を検査。問題があれば非ゼロで終了する
```

CI では Lint & Type Check ジョブが `vp run lint` の後に `vp run knip` を実行する。
新しい未使用コードが入ると CI が落ちる。

## 設定（knip.json）

設定はリポジトリルートの `knip.json` に集約し、`workspaces` で
apps/mobile・apps/api・packages/* ごとに分けている。

knip は各種プラグインでエントリを自動補完する。Expo Router の `apps/mobile/app/`、
wrangler の `src/index.ts`、Workflows のクラス、jest / vitest の設定・セットアップ・
モック、Taskfile のタスク等はプラグインが拾う。

プラグインでは辿れない参照は `entry` に個別指定している。現状の主なもの:

- `apps/mobile`: `metro.config.ts`、拡張子分割（`*.native.ts` / `*.web.ts` /
  `*.ios.ts` 等。Metro のプラットフォーム解決は静的解析で辿れない）、
  jest の `@jest-environment` pragma が指す `jest.jsdom-env.cjs`
- `apps/api`: `drizzle.config.ts`、Taskfile の `dir:` 付きタスクから起動される
  `scripts/*.mjs`、Hono RPC 型生成の入口 `src/rpcSchema.ts`
  （typegen は tsconfig の include で読むため、import グラフには現れない）
- `packages/api-contract`: `hono` は生成物 `generated/rpcSchema.d.ts` が
  `import("hono/types")` で参照するが、生成物をコミットしないため
  `ignoreDependencies` に入れている

## 誤検出への対処

検出結果を見て、本当に使われていないものだけを削除する。判断に迷うもの
（設定ファイルから文字列で参照される、ネイティブモジュールの契約型、
将来使う予定とコメントのあるもの等）は削除せず、`ignore` /
`ignoreDependencies` / `entry` に**理由をコメントで書いて**追加する。

依存を削除した場合は `vp install` で lockfile にも反映する。
本番依存を消したときは Metro のバンドルと typecheck が通ることを確認する。

## 削除時の注意

「未使用 export」は `export` キーワードを外すだけで済むことが多い
（同じファイル内では使われている型等）。ファイルごと消すのは
そのファイルへの参照がどこにも無い場合だけ。
