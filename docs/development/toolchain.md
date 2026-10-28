# 開発ツールチェーン（Vite+ / Oxc / TypeScript 7）

ツールチェーンの版を上げる・設定を変える・挙動を調べるときに読む。
日々の開発で使うコマンドはルートの AGENTS.md を参照。

## Vite+（vp）と版管理

JS ツールチェーンは [Vite+](https://viteplus.dev/guide/)（`vp`）で管理する（issue #246）。
Node.js は package.json の `devEngines.runtime`、pnpm は `packageManager` で固定しており、
`vp` がプロジェクトに入ると自動でそのバージョンに切り替わる（`vp env current` で確認）。
バージョンを上げるときは `vp env pin --target dev-engines <版>` を使い、
書き込まれた `onFail` を `"error"` に戻す（下記）。
Nix devShell・turbo・lefthook は廃止した。

> `devEngines.runtime` の `onFail` は `"error"` にしておく。`"download"` だと pnpm 10 も
> Node を依存として扱い、pnpm-lock.yaml に Node 本体を追加してダウンロードする（vp と二重管理）。
> `"error"` なら pnpm は版の検査だけを行い、Node の取得は vp に任せられる。

vite-plus は root の devDependency で版を固定しており（issue #250）、グローバルの `vp` は
プロジェクト内の vite-plus に処理を委ねる（`vp --version` の "Local vite-plus" で確認）。
`vite.config.ts` は `vite-plus` の `defineConfig` で書く。
vite-plus・vite・vitest の版は `pnpm-workspace.yaml` の `catalog` で一元管理し、
各 package.json からは `catalog:` で参照する。`overrides` でも vite / vitest を同じ版に
揃えている（[local-cli](https://viteplus.dev/guide/local-cli)）。vite-plus を上げるときは
catalog の `vite-plus`、`vite` の別名（`@voidzero-dev/vite-plus-core@<版>`）、
`vp --version` が示す vitest の版の 3 つを揃えて更新する。
vitest を使うパッケージは `vite: "catalog:"` も devDependency に持たせる
（vitest の peer の vite を自動インストールに任せると overrides が効かず別版が入る）。
api の Workers テストは vitest 5 対応の `@cloudflare/vitest-plugin`
（旧 `@cloudflare/vitest-pool-workers`）で動かす。
CI の `voidzero-dev/setup-vp` は package.json の vite-plus から版を自動検出する。

開発ループのタスクはルートの `vite.config.ts`（`run.tasks`）に定義してある。
各タスクは全パッケージの package.json scripts（一部は各パッケージの `vite.config.ts` のタスク）を横断実行する。

## 整形（Oxfmt）と検査（Oxlint）

整形は vite-plus 同梱の oxfmt を `vp fmt` 経由で実行し、各パッケージ・ルートで
個別の oxfmt は入れない（issue #268）。設定はルート `vite.config.ts` の `fmt`
ブロックに集約する。Vite+ モードでは nested config（`.oxfmtrc.json`）が効かないため、
パッケージ別の `printWidth`（mobile / api / danime-core は 80、observability と
ルートは既定の 100）は `fmt.overrides` で表す。
`fmt` / `fmt:check` は各パッケージの script に加えて、ルート直下とパッケージ外のファイル
（ルートの `vite.config.ts`・`.github/workflows/*.yml`・`Taskfile.yml` 等）もルートの
`vp fmt` で整形・確認する（issue #254）。

lint も fmt と同様に vite-plus 同梱の oxlint を `vp lint` 経由で実行し、
各パッケージ・ルートで個別の oxlint は入れない（issue #267。版は vite-plus に従う）。
Vite+ モードではネストした oxlint 設定（`oxlint.config.ts` / `.oxlintrc.json`）が
効かないため、設定はルート `vite.config.ts` の `lint` ブロックに集約する。
パッケージ別のルール（mobile の universe/native プリセット、api の
`no-restricted-properties` 等）は `lint.overrides` で表す。
`lint` / `lint:fix` は各パッケージの script に加えて、ルート直下とパッケージ外の
TS / JS もルートの `vp lint` で検査する（issue #269）。

整形・検査の対象外はルートの `.oxfmtignore` で指定し、fmt・lint のどちらの
呼び出しにも `--ignore-path` で渡す（`.agents/` 等のエージェント状態は対象外）。
`.oxfmtignore` は自動では読まれないため、flag を付けない裸の `vp fmt` には効かない。
oxfmt では positional の `'!apps/**'` が否定パターンとして効くが、
oxlint の positional は `!` を解さない。ルートの `vp lint` でパッケージを
外すときは `--ignore-pattern 'apps/**'` を使う（`vp run lint` の定義を参照）。

### type-aware ルール（tsgolint）

`lint.options.typeAware` で tsgolint による type-aware ルールを有効にしている
（issue #277）。型情報は各ファイルから最も近い tsconfig で自動解決される
（`baseUrl` を含む tsconfig があると type-aware がスキップされる）。
有効化しているルール: `typescript/no-floating-promises`・`typescript/await-thenable`・
`typescript/no-unnecessary-type-assertion`・`typescript/restrict-template-expressions`・
`typescript/no-misused-promises`（`checksVoidReturn: false`。onPress={asyncFn} や
モック実装の誤検知を避けるため universe の typescript-analysis と同じ設定）。
correctness カテゴリの type-aware ルール（`no-base-to-string` 等）も
型情報が取れるようになったことで有効に動くようになっている。

type-aware は tsgolint が TypeScript プログラムを読むため、パッケージ lint 1 回で
ピークメモリ ~1GB 程度になる（mobile 実測）。

## 型チェック（TypeScript 7）

型チェックは TypeScript 7（Go 実装のネイティブ版）の `tsc` で行う（issue #248）。
各パッケージは `pnpm-workspace.yaml` の `catalog` で次の 2 つを入れている。

- `@typescript/native`（`typescript@7` の別名）: bin は `tsc`。typecheck script が使う
- `typescript`（`@typescript/typescript6` の別名）: TypeScript 6 の API 互換パッケージ。bin は `tsc6`

TypeScript 7 には JS API が無い。Expo（`metro.config.ts` の読み込みや tsconfig の評価）は
`require('typescript')` で TypeScript 6 の API を使うので、`typescript` の名前は 6 のままにしてある。
VS Code の tsdk（`.vscode/settings.json`）は実体の TypeScript 6（`node_modules/@typescript/old/lib`）を指す。

> typecheck は `tsc --noEmit --checkers 1` で実行する。TypeScript 7 は既定で型チェッカーを
> 4 並列で動かすため、mobile ではピークメモリが tsc 6 より大きくなる。`--checkers 1` なら
> 時間・メモリともに tsc 6 を下回る（計測は issue #248 の PR を参照）。
> TypeScript 6 の結果と比べたいときは `vp -C apps/mobile exec tsc6 --noEmit` のように `tsc6` を使う。

各パッケージの tsconfig は `vite.config.ts`（`vp run` のタスク定義）も include に含めており、
型チェックの対象になっている（issue #271）。ルートの `vite.config.ts` はどのパッケージにも
属さないため、ルートの `tsconfig.json` が include し、`vp run typecheck` が各パッケージの
typecheck に続いてルートでも `tsc --noEmit --checkers 1` を実行する。ルートの tsconfig は
solution style ではなく、ルート直下の TS ファイルを直接チェックする通常の設定。

各パッケージの tsconfig はテストファイルも型チェックの対象に含める（issue #307）。
api / observability は tsconfig の `exclude` でテスト glob を外していない
（mobile / danime-core と同じ）。テストは型チェックに加えて tsgolint の
type-aware ルールの対象にもなるので、対象外の tsconfig（`tsconfig.test.json` 等）は
作らない。api の Workers テストが使う `cloudflare:workers` の `env` と
`caches.default` の型は `apps/api/src/test-utils/workers-env.d.ts` で宣言マージしている。

## タスクキャッシュ

typecheck / lint / fmt:check / test の結果は `vp run` がキャッシュし、入力ファイル
（タスクが実際に読んだファイルを自動追跡）が変わらなければ出力を再生して実行を省く。
キャッシュは `node_modules/.vite/task-cache` に置かれ、`vp cache clean` で消せる。
CI（ci.yml）はこのディレクトリを GitHub Actions cache で実行間に持ち越す（issue #253。
キーと共有範囲は ci.yml 冒頭のコメントを参照）。
持ち越したキャッシュは、タスク定義の変更や vite-plus の更新で古いエントリが溜まっていくため、
復元直後のサイズが `VITE_TASK_CACHE_LIMIT_KB`（ci.yml の `env`）を超えたら `vp cache clean` で
捨てる（issue #272）。閾値に届く前に一掃したいときは、この値を一時的に下げる。
mobile の jest と vitest（`test:vitest`）もキャッシュする（issue #251）。jest は Haste マップの
クロールでテストファイルの追加・削除を検知できるよう、`apps/mobile/jest.config.cjs` で
watchman と `find` を使わず Node の fs API でクロールさせている（外すと、テストファイルを
足してもキャッシュヒットしてしまう）。

> キャッシュするタスクは**クリーンな環境変数**で実行される（`PATH` `HOME` `CI` 等の
> 共通の変数のみ引き継ぐ）。タスクが新たに環境変数を必要とする場合は、そのタスクの
> `cache.env`（値が変わるとキャッシュを無効化）か `cache.untrackedEnv`（渡すだけ）に追加する。
> キャッシュしない script（dev・e2e:ios 等）には環境変数がそのまま渡る。

## 並列数

`vp run` は既定で最大 4 タスクを同時に実行する。`VP_RUN_CONCURRENCY_LIMIT` か
`--concurrency-limit`（こちらが優先）で絞れる。

`VP_RUN_CONCURRENCY_LIMIT` が絞るのは `vp run` のタスク並列数だけで、
タスク内のプロセス並列数（jest のワーカー等）には効かない。mobile の jest は
`apps/mobile/jest.config.cjs` の `maxWorkers: "50%"` でワーカー数をコア数の
半分に絞ってある（issue #293）。

## Git フック

`vp install` 時の `prepare`（`vp config --no-agent`）が `.vite-hooks/_` にフックの
ディスパッチャを置き、`core.hooksPath` を設定する。フック本体は `.vite-hooks/` にある。

- pre-commit: `vp staged`。**ステージ済みのファイルだけ**を Oxlint と Oxfmt（`vp fmt`）に
  かけ、整形した差分はステージし直す（ルール本体は `vite.config.ts` の `staged`）。
  ルート直下とパッケージ外のファイルも、TS / JS は Oxlint と Oxfmt、
  それ以外（json / yml 等）は Oxfmt だけをかける
- pre-push: `vp run typecheck` と `vp run test`

> `core.hooksPath` は main チェックアウトと全 worktree で共有される `.git/config` に書かれる。
> フックのディスパッチャ（`.vite-hooks/_`、gitignore 済み）は worktree ごとに `vp install`
> で生成される。
