# AGENTS.md

## 開発環境

JS ツールチェーンは [Vite+](https://viteplus.dev/guide/)（`vp`）で管理する（issue #246）。
Node.js は package.json の `devEngines.runtime`、pnpm は `packageManager` で固定しており、
`vp` がプロジェクトに入ると自動でそのバージョンに切り替わる（`vp env current` で確認）。
バージョンを上げるときは `vp env pin --target dev-engines <版>` を使い、
書き込まれた `onFail` を `"error"` に戻す（下記）。
Nix devShell・turbo・lefthook は廃止した。

> `devEngines.runtime` の `onFail` は `"error"` にしておく。`"download"` だと pnpm 10 も
> Node を依存として扱い、pnpm-lock.yaml に Node 本体を追加してダウンロードする（vp と二重管理）。
> `"error"` なら pnpm は版の検査だけを行い、Node の取得は vp に任せられる。

```bash
curl -fsSL https://vite.plus | bash   # vp 本体（グローバル CLI）。初回のみ
vp install                            # 依存インストール + Git フック設置（prepare の vp config）
```

> vite-plus は root の devDependency で版を固定しており（issue #250）、グローバルの `vp` は
> プロジェクト内の vite-plus に処理を委ねる（`vp --version` の "Local vite-plus" で確認）。
> `vite.config.ts` は `vite-plus` の `defineConfig` で書く。
> vite-plus・vite・vitest の版は `pnpm-workspace.yaml` の `catalog` で一元管理し、
> 各 package.json からは `catalog:` で参照する。`overrides` でも vite / vitest を同じ版に
> 揃えている（[local-cli](https://viteplus.dev/guide/local-cli)）。vite-plus を上げるときは
> catalog の `vite-plus`、`vite` の別名（`@voidzero-dev/vite-plus-core@<版>`）、
> `vp --version` が示す vitest の版の 3 つを揃えて更新する。
> vitest を使うパッケージは `vite: "catalog:"` も devDependency に持たせる
> （vitest の peer の vite を自動インストールに任せると overrides が効かず別版が入る）。
> api の Workers テストは vitest 5 対応の `@cloudflare/vitest-plugin`
> （旧 `@cloudflare/vitest-pool-workers`）で動かす。
> CI の `voidzero-dev/setup-vp` は package.json の vite-plus から版を自動検出する。

## コマンド実行

開発ループのタスクはルートの `vite.config.ts`（`run.tasks`）に定義してあり、`vp run` で実行する。
各タスクは全パッケージの package.json scripts（一部は各パッケージの `vite.config.ts` のタスク）を横断実行する。

```
vp run typecheck   # 型チェック (TypeScript 7 の tsc --noEmit)。CI の "TypeScript check" 相当
vp run lint        # Oxlint
vp run lint:fix    # Oxlint の自動修正
vp run fmt         # Oxfmt で整形
vp run fmt:check   # 整形済みかの確認。CI の "Oxfmt check" 相当
vp run test        # テスト（mobile は jest + vitest、それ以外は vitest）
vp run dev         # 全アプリの開発サーバを並列起動
```

> `fmt` / `fmt:check` は各パッケージの script に加えて、ルート直下とパッケージ外のファイル
> （ルートの `vite.config.ts`・`.github/workflows/*.yml`・`Taskfile.yml` 等）もルートの oxfmt
> （各パッケージと同じ 0.57 系、設定は既定値）で整形・確認する（issue #254）。
> `lint` / `lint:fix` も同様に、ルート直下とパッケージ外の TS / JS をルートの oxlint
> （各パッケージと同じ 1.72 系、設定は既定値）で検査する（issue #269）。
> ルート向けの整形・検査はどちらも `.oxfmtignore` を共用し、
> `.agents/` 等のエージェント状態は対象外。

パッケージ内のコマンドは `vp run <パッケージ名>#<script>` で実行する
（`vp run --filter <パッケージ名> <script>` も同じ）。

```
vp run @animeishi/mobile#dev                   # Expo モバイルアプリを起動
vp run @animeishi/mobile#annict-redirect-uri   # Expo Go 実機用の Annict redirect_uri を表示
vp run @animeishi/mobile#e2e:ios               # iOS シミュレーターで Maestro E2E を実行
vp run @animeishi/api#dev                      # Cloudflare Workers API を起動 (wrangler dev)
vp run @animeishi/api#dev:scheduled            # Cron を手動トリガーできる状態で API を起動
vp run @animeishi/api#db:migrate:local         # D1 ローカルマイグレーション適用
```

> `dev:scheduled` の起動後は、別端末から
> `curl "http://localhost:8787/__scheduled?cron=0+*/6+*+*+*"` で画像フォールバックの
> ウォームアップ Cron を手動トリガーできる。

### 型チェック（TypeScript 7）

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

### キャッシュ

typecheck / lint / fmt:check / test の結果は `vp run` がキャッシュし、入力ファイル
（タスクが実際に読んだファイルを自動追跡）が変わらなければ出力を再生して実行を省く。
キャッシュは `node_modules/.vite/task-cache` に置かれ、`vp cache clean` で消せる。
CI（ci.yml）はこのディレクトリを GitHub Actions cache で実行間に持ち越す（issue #253。
キーと共有範囲は ci.yml 冒頭のコメントを参照）。
mobile の jest と vitest（`test:vitest`）もキャッシュする（issue #251）。jest は Haste マップの
クロールでテストファイルの追加・削除を検知できるよう、`apps/mobile/jest.config.cjs` で
watchman と `find` を使わず Node の fs API でクロールさせている（外すと、テストファイルを
足してもキャッシュヒットしてしまう）。

> キャッシュするタスクは**クリーンな環境変数**で実行される（`PATH` `HOME` `CI` 等の
> 共通の変数のみ引き継ぐ）。タスクが新たに環境変数を必要とする場合は、そのタスクの
> `cache.env`（値が変わるとキャッシュを無効化）か `cache.untrackedEnv`（渡すだけ）に追加する。
> キャッシュしない script（dev・e2e:ios 等）には環境変数がそのまま渡る。

### 並列数（並列 worktree 運用時）

`vp run` は既定で最大 4 タスクを同時に実行する。複数の worktree で同時に
エージェントを走らせるとき（jest・tsc・workerd がそれぞれメモリを食う）は、
`VP_RUN_CONCURRENCY_LIMIT` で並列数を絞る。`--concurrency-limit` を付けた場合はそちらが優先される。

```bash
VP_RUN_CONCURRENCY_LIMIT=1 vp run test
vp run --concurrency-limit 2 typecheck
```

### mobile のテスト（jest / vitest）

mobile のテストは jest と vitest に分かれている（issue #249）。
`vp run @animeishi/mobile#test` は `test:vitest`（vitest）を先に回してから jest を回す。

- **vitest**（`apps/mobile/vitest.config.ts`）: RN / Expo / jest-expo のモックや
  jsdom に依存しない純ロジックのテスト。ファイル名を `*.unit.test.ts` にし、
  `describe` / `it` / `expect` / `vi` は `vitest` から import する
- **jest**（`apps/mobile/jest.config.cjs`）: 上記以外（コンポーネントテスト、
  `jest.mock` でモジュールを差し替えるテスト、jest.setup.js の初期化に依存するテスト）。
  `*.unit.test.ts` は `testPathIgnorePatterns` で対象から外している

新しく書くテストが純ロジックだけなら `*.unit.test.ts`、判断に迷うなら jest 側
（`*.test.ts(x)`）に置く。`@/` と `@animeishi/*` の解決は両設定で揃えている。

変更したファイルに関係するテストだけを回すときは、`apps/mobile` で直接実行する。

```bash
vp -C apps/mobile exec jest --findRelatedTests lib/foo.ts components/Bar.tsx  # 指定ファイルに依存する jest テスト
vp -C apps/mobile exec jest --changedSince=main                               # main からの変更に関係する jest テスト
vp -C apps/mobile exec vitest related --run lib/foo.ts                        # 指定ファイルに依存する vitest テスト
vp -C apps/mobile exec vitest run --changed main                              # main からの変更に関係する vitest テスト
```

### Git フック

`vp install` 時の `prepare`（`vp config --no-agent`）が `.vite-hooks/_` にフックの
ディスパッチャを置き、`core.hooksPath` を設定する。フック本体は `.vite-hooks/` にある。

- pre-commit: `vp staged`。**ステージ済みのファイルだけ**を Oxlint と Oxfmt にかけ、
  整形した差分はステージし直す（ルール本体は `vite.config.ts` の `staged`）。
  ルート直下とパッケージ外のファイルも、TS / JS は Oxlint と Oxfmt、
  それ以外（json / yml 等）は Oxfmt だけをかける
- pre-push: `vp run typecheck` と `vp run test`

> CI の "Lint & Type Check" ジョブは **Oxlint と型チェック (TypeScript 7 の tsc --noEmit) の 2 段**で構成される。
> `vp run lint` は Oxlint だけで型エラーは拾えない。push 前は必ず `vp run typecheck`
> （または `vp run test` と併せて）を実行して CI 落ちを未然に防ぐこと。pre-push フックでも自動実行される。

> `core.hooksPath` は main チェックアウトと全 worktree で共有される `.git/config` に書かれる。
> フックのディスパッチャ（`.vite-hooks/_`、gitignore 済み）は worktree ごとに `vp install`
> で生成されるので、新しい worktree では最初に `vp install` を実行する。
> 一時的にフックを止めたいときは `VP_GIT_HOOKS=0 git commit ...` とする。

## 本番運用タスク（Taskfile）

本番・プレビュー環境の運用操作は、確認プロンプト（`prompt:`）やメモの安全な受け渡しが
go-task に依存しているため Taskfile.yml に残している。go-task はルートの devDependency
（`@go-task/cli`）で入るので、`pnpm task <タスク名>` で実行する（一覧は `pnpm task --list`）。

```
* db:migrate:prod:list:   本番 D1 の未適用マイグレーションを確認（非破壊）
* db:migrate:prod:        本番 D1 にマイグレーション適用（破壊的操作あり・確認プロンプト付き）
* db:migrate:preview:list: プレビュー D1 の未適用マイグレーションを確認（非破壊）
* db:migrate:preview:     プレビュー D1 にマイグレーション適用
* reports:list:           本番 D1 の通報一覧を表示（既定: 未対応のみ。issue #186）
* reports:resolve:        本番の通報を対応済みにする（確認プロンプト付き）
* reports:dismiss:        本番の通報を却下する（確認プロンプト付き）
* reports:reopen:         本番の通報を未対応に戻す（確認プロンプト付き）
* reports:list:local:     ローカル D1 の通報一覧を表示
* reports:update:local:   ローカル D1 の通報ステータスを更新（動作確認用）
* images:backfill:        本番の未取り込み作品画像を画像プロキシ経由で一括取り込み
* images:takedown:        本番の作品画像を削除し、以後の補完を止める（MAL の削除依頼対応。確認プロンプト付き）
```

> 本番 D1 へのマイグレーション適用は deploy-api.yml がデプロイ前に自動で行うため、
> main へのマージ後に手動で `pnpm task db:migrate:prod` を実行する必要はない。
> 手動タスクは手動デプロイ時や DB 再作成時のリカバリ用途で残してある。

> 通報モデレーション（reports.*）は `apps/api/scripts/reports.sh` の
> Taskfile ラッパー。使い方は `bash apps/api/scripts/reports.sh --help`。
> `pnpm task reports:list -- --status all`、`pnpm task reports:list -- --by-user` のように
> `--` 以降でオプションを渡せる。更新系は id を `--` 以降、対応メモを
> `NOTE='メモ'` で渡す（例: `pnpm task reports:resolve NOTE='対応済み' -- 5`）。
> メモは環境変数経由でスクリプトに渡るため、引用符・`$`・バッククォート等を
> そのまま含めてよい。プレビュー D1 を見る場合は
> `bash apps/api/scripts/reports.sh --env preview list` を直接叩く。

> 作品画像の削除（images:takedown）は `apps/api/scripts/takedown-work-images.sh` の
> Taskfile ラッパー（issue #241）。MAL API の規約により、MAL から削除依頼が来たら
> MAL 由来の画像（`image_source='mal'`）を 24 時間以内に消す必要がある。
> 作品 ID を `--` 以降に並べる（例: `pnpm task images:takedown -- 123 456`）か、
> `pnpm task images:takedown -- --all-mal` で MAL 由来の全件を対象にする。
> 件数と一覧を表示してから確認プロンプトを出し、対象を `image_source='blocked'`・
> `resolved_image_url` NULL にしてから、R2 のオブジェクトを消して `image_r2_key` を NULL にする。
> R2 から消せなかったキーは DB に残るので、表示された作品 ID で再実行する。
> `'blocked'` の作品は cron・画像プロキシ・検索のどこからも補完し直さない
> （Annict の元の画像は MAL 由来ではないので、プロキシは引き続き配信する）。
> プロキシ前段のキャッシュは消せないが、MAL 由来の画像は Cache-Control を
> 合計 12 時間以下にしてあるので、実行後 12 時間以内に切れる。
> ただし短縮前（issue #241 のデプロイ前）に入ったキャッシュは 1 日 +
> `stale-while-revalidate` 7 日のままなので、デプロイから 8 日間は 24 時間以内に
> 切れる保証がない。その間に削除依頼が来たら、Cloudflare ダッシュボードの
> Purge Cache（Custom Purge の URL 指定）で `https://<API ドメイン>/images/works/<id>` も消す。
> 使い方は `bash apps/api/scripts/takedown-work-images.sh --help`。プレビューは
> `--env preview`、ローカル（wrangler dev の D1・R2）は `--local` を直接付けて叩く。

> wrangler は `apps/api/node_modules` にのみ入っている（ルートには入れない方針）。
> ルートから叩くときは `dir: apps/api` 付きの task 経由にする。デプロイ・本番 D1 操作は
> 上記 `db:migrate:prod*` のように Taskfile に集約し、wrangler の場所を意識せず実行できるようにする。

## E2E テスト（Maestro / iOS シミュレーター）

Maestro による E2E を `apps/mobile/.maestro/` に置く。
第 1 弾の対象は認証ライフサイクル（サインアップ→ホーム→サインアウト→
サインイン→アカウント削除）で、`flows/auth-lifecycle.yaml` がエントリポイント。
`subflows/` は `runFlow` から呼ばれる部品なので直接実行しない。

```bash
vp run @animeishi/mobile#e2e:ios
```

> **運用ルール（#180）**: E2E は CI では回さない（macOS ランナーのコストのため）。
> 代わりに、`apps/mobile` に影響する PR（認証・ナビゲーション・ホーム周りなど
> E2E フローが通る画面を触るもの）は、**マージ前にローカルで `vp run @animeishi/mobile#e2e:ios` を
> 通す**。結果（PASS / 失敗時の原因）は PR にコメントで残す。

`e2e:ios`（`apps/mobile/scripts/e2e-ios.sh`）が行うこと:

1. E2E 専用シミュレーター `animeishi-e2e-<ワークツリー名>` を `simctl create` で作成
   （既にあれば再利用。ワークツリー単位で一意なため、同一ホストで並列実行しても
   他作業者のシミュレーターと衝突しない）
2. `ios/` が無ければ `expo prebuild -p ios`
3. `xcodebuild -configuration Release -sdk iphonesimulator` で Release 相当ビルド
   （成果物: `ios/build/e2e-dd/Build/Products/Release-iphonesimulator/Animeishi.app`）
   - 署名は `CODE_SIGN_IDENTITY="-"`（ad-hoc）にする。
     `CODE_SIGNING_ALLOWED=NO` にすると entitlements がバイナリに埋め込まれず
     Keychain（expo-secure-store で Clerk のセッション保存に使用）が
     `SecError -34018` で失敗し、`signUp.create` が `status:null` の
     空リソースを返してサインアップが進まなくなる
4. シミュレーターへアプリを再インストールして `maestro test .maestro` を実行

### 前提

- maestro CLI: `brew install mobile-dev-inc/tap/maestro`（JDK も必要）
- Xcode + iOS シミュレーターランタイム
- `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`: **必ず pk_test**（Clerk 開発インスタンス、
  GitHub Variable `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY_PREVIEW` と同じ値）。
  未設定なら `apps/mobile/.env` を読む。pk_live はスクリプトが拒否する
- `EXPO_PUBLIC_API_URL`: 既定 `http://localhost:8787`。
  API（wrangler dev）が未起動ならスクリプトが起動し、終了時に停止する。
  アカウント削除は `DELETE /me` を叩くため API が必須（`apps/api/.dev.vars`
  に開発インスタンスの `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` が要る）
- ローカル D1 マイグレーション済みであること（`vp run @animeishi/api#db:migrate:local`。
  スクリプトが API 起動時に適用するが、API 常駐派は事前に回しておく）

Clerk 認証は dev インスタンスのテストモードを使う。毎回ユニークな
`e2e<ts>+clerk_test@example.com` でサインアップする。メール認証が求められた
場合は固定コード `424242` で通すが、test_mode の `+clerk_test` では認証が
自動スキップされ `status=complete` でホーム直行することもあるため、
`subflows/sign-up.yaml` は `verification-code-input` が出た時だけ
`subflows/verify-email.yaml` でコード入力する分岐になっている。
最後にアカウント削除まで行うため Clerk 側にゴミは残らない
（削除失敗時のみ dev ダッシュボードから手動削除する）。

便利な環境変数:

- `E2E_SKIP_BUILD=1` … ビルドをスキップ（既存の `ios/build/e2e-dd` を再利用）
- `E2E_SIM_NAME` … 専用シミュレーター名を変更（既定 `animeishi-e2e-<ワークツリー名>`）

> e2e-ios.sh は通常のシェル（vp が入れた node / pnpm が PATH にある状態）から
> そのまま xcodebuild 等を実行する。`CC` `SDKROOT` `DEVELOPER_DIR` などの
> toolchain 変数を export したシェルから叩くと xcodebuild のネイティブビルドが
> 壊れるので、その場合は変数を外してから実行する（旧 Nix devShell で起きた問題。
> スクリプト側の回避策は #252 で外した）。

## プラットフォーム差異の吸収（Web / iOS / Android）

カメラ・通知・ダイアログ等でプラットフォーム固有の実装が必要なときは、
コード中で `Platform.OS === "web"` を分岐させず、ファイル拡張子による自動解決
（Expo 標準）でモジュールを切り替える。

```text
foo.web.ts      ← Web 用実装
foo.native.ts   ← iOS/Android 共通実装
foo.ts          ← フォールバック兼・型定義（実装は解決されないので throw でよい）
types.ts        ← 共通インターフェース（型定義）の置き場所
index.ts        ← バレル（呼び出し側はここを import する）
```

呼び出し側は常に拡張子なしで import するだけでよく、バンドラー
（Metro / webpack）がプラットフォームに応じて `.web` / `.native` を自動選択する。

```ts
import { confirm } from "@/lib/dialog"; // 実装は自動で切り替わる
```

### リファレンス実装

ダイアログ（alert / confirm）の差異吸収を `apps/mobile/lib/dialog/` に実装している。
新規にカメラ・通知・位置情報等を実装する際はこのパターンに倣う。

> 表示文言（ボタンラベル等）は基盤側に既定値を持たせず、必ず呼び出し側が渡す。
> i18n の `t()` への依存を低レベルな抽象化基盤に持ち込まないため。
>
> 補足: `KeyboardAvoidingView` の `behavior` のような 1 行のレイアウト微調整は、
> 拡張子分割せず `Platform.OS` の三項演算で済ませてよい。
> モジュール単位で実装が分かれる差異だけを拡張子分割の対象とする。

## タスク管理

作業中にタスクのスコープ外として先送りにするタスク・課題はgithubのissueに登録することをユーザーに提案してください。
