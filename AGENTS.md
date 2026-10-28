# AGENTS.md

作業のたびに必要になる手順とルールだけを書く。仕組みの詳細や経緯は下の docs を読む。

| 読むとき | 文書 |
| --- | --- |
| ツールチェーン（vp・Oxlint/Oxfmt・TypeScript 7・キャッシュ・Git フック）の版上げ・設定変更 | `docs/development/toolchain.md` |
| テスト設定の変更、テストがどの環境で動くかの確認 | `docs/development/testing.md` |
| E2E の初回実行・失敗調査・スクリプト変更 | `docs/development/e2e-ios.md` |
| 本番・プレビューの手動操作（マイグレーション・通報対応・画像削除） | `docs/runbook/production-tasks.md` |
| 機能の設計 | `docs/NN_*.md` |

## セットアップ

JS ツールチェーンは [Vite+](https://viteplus.dev/guide/)（`vp`）で管理する。Node.js・pnpm の版は
`vp` が package.json に合わせて自動で切り替える。

```bash
curl -fsSL https://vite.plus | bash   # vp 本体（グローバル CLI）。初回のみ
vp install                            # 依存インストール + Git フック設置。新しい worktree でも最初に実行する
```

## コマンド

```
vp run typecheck   # 型チェック (TypeScript 7 の tsc --noEmit)。CI の "TypeScript check" 相当
vp run lint        # Oxlint（type-aware ルール有効）
vp run lint:fix    # Oxlint の自動修正
vp run fmt         # Oxfmt で整形
vp run fmt:check   # 整形済みかの確認。CI の "Oxfmt check" 相当
vp run test        # テスト（mobile は jest + vitest、それ以外は vitest）
vp run dev         # 全アプリの開発サーバを並列起動
```

パッケージ内のコマンドは `vp run <パッケージ名>#<script>` で実行する。

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

- **push 前は必ず `vp run typecheck` を通す。** `vp run lint` は型エラーを拾わない
  （pre-push フックでも typecheck と test が走る）
- 整形・lint の設定はルートの `vite.config.ts` に集約している。パッケージに
  `.oxfmtrc.json` や `.oxlintrc.json` を置いても効かない
- `vp fmt` / `vp lint` を直接叩くときは `--ignore-path .oxfmtignore` を付ける
  （付けないと除外指定が効かない）。Markdown は整形の対象外
- キャッシュするタスクはクリーンな環境変数で実行される。タスクに環境変数を
  渡す必要があれば `vite.config.ts` のタスクの `cache.env` か `cache.untrackedEnv` に足す
- 一時的にフックを止めたいときは `VP_GIT_HOOKS=0 git commit ...`

### 並列 worktree で作業するとき

`vp run` は既定で 4 タスクを並列実行し、jest・tsc・tsgolint・workerd はそれぞれメモリを食う
（type-aware lint はパッケージ 1 回で ~1GB）。同時に動かすエージェントは 2〜3 までとし、
各エージェントは `VP_RUN_CONCURRENCY_LIMIT=2 vp run ...` で実行する。
それでも重いときは `VP_RUN_CONCURRENCY_LIMIT=1` に下げる。

## テストの書き方

### mobile

- RN / Expo / jest-expo のモックに依存しない純ロジックのテストは vitest。
  ファイル名を `*.unit.test.ts` にし、`describe` / `it` / `expect` / `vi` は `vitest` から import する。
  `window` が必要なら先頭に `// @vitest-environment jsdom` を付ける
- それ以外（コンポーネント、`jest.mock` を使うもの、jest.setup.js に依存するもの）は jest
  （`*.test.ts(x)`）。判断に迷ったら jest 側に置く

変更に関係するテストだけを回すときは `apps/mobile` で直接実行する。

```bash
vp -C apps/mobile exec jest --findRelatedTests lib/foo.ts components/Bar.tsx
vp -C apps/mobile exec jest --changedSince=main
vp -C apps/mobile exec vitest related --run lib/foo.ts
vp -C apps/mobile exec vitest run --changed main
```

### api

- 新しいテストファイルは既定で `isolated` プロジェクト（ファイルごとに workerd を起動）に入る
- **`vi.mock` を使うファイルは `shared` プロジェクトの include に合わせない**
  （`shared` はモジュールとストレージをファイル間で共有するので、モックがずれて失敗する）。
  `shared` に足すのは共有状態でも正しく動くと確認できたものだけ
- `vp -C apps/api exec vitest run --project isolated`（`shared` / `node` も同様）で片方だけ実行できる

### E2E

E2E は CI では回さない。**`apps/mobile` の認証・ナビゲーション・ホーム周りなど
E2E フローが通る画面を触る PR は、マージ前にローカルで `vp run @animeishi/mobile#e2e:ios` を通し、
結果（PASS / 失敗時の原因）を PR にコメントで残す。** 前提と仕組みは `docs/development/e2e-ios.md`。

## 本番運用

本番・プレビューの操作は `pnpm task <タスク名>` で行う（一覧は `pnpm task --list`、手順は
`docs/runbook/production-tasks.md`）。デプロイ・本番 D1 の操作は Taskfile に集約している。
本番 D1 のマイグレーションは main へのマージ後に deploy-api.yml が自動で適用する。

## プラットフォーム差異の吸収（Web / iOS / Android）

カメラ・通知・ダイアログ等でプラットフォーム固有の実装が必要なときは、
コード中で `Platform.OS === "web"` を分岐させず、ファイル拡張子による自動解決
（Expo 標準）でモジュールを切り替える。リファレンス実装は `apps/mobile/lib/dialog/`。

```text
foo.web.ts      ← Web 用実装
foo.native.ts   ← iOS/Android 共通実装
foo.ts          ← フォールバック兼・型定義（実装は解決されないので throw でよい）
types.ts        ← 共通インターフェース（型定義）の置き場所
index.ts        ← バレル（呼び出し側はここを拡張子なしで import する）
```

- 表示文言（ボタンラベル等）は基盤側に既定値を持たせず、必ず呼び出し側が渡す
  （i18n の `t()` への依存を低レベルな基盤に持ち込まないため）
- `KeyboardAvoidingView` の `behavior` のような 1 行のレイアウト微調整は、
  拡張子分割せず `Platform.OS` の三項演算で済ませてよい

## 書く内容と置き場所

情報の置き場所は「誰が・いつ・何のために読むか」で決め、それぞれの場所には
その読み手が必要とする問いへの答えだけを書く。1 か所に 5W1H を全部書かない。
同じ内容を複数の場所に重複させず、詳しい理由は issue 番号・PR・docs のパスで参照する
（重複させると片方が必ず古くなる）。

| 置き場所 | 書くこと | 具体的には |
| --- | --- | --- |
| コード | How | 命名と構造で処理が読めるようにする |
| コードコメント | Why not | 素直な書き方を採らなかった理由。消すと誰かが「改善」して壊すものだけを書き、処理の言い換えは書かない |
| テスト | What | テスト名で振る舞い・仕様を表す |
| CI/CD 設定（`.github/workflows/`） | When + How | どの条件で走り、何をするか |
| コミットメッセージ | Why | その変更が必要になった理由。差分を見れば分かる What は並べない |
| PR 本文 | What + Why | 何を変えたか、なぜか |
| 設計文書（`docs/NN_*.md`） | Why + What if | 検討した選択肢、採らなかった案、前提が変わったときどうするか |
| 判断の記録（ADR 相当。issue に残す） | Why + When | 何をなぜ決めたか、いつ・どの前提で決めたか |
| 開発者向け解説（`docs/development/`） | What + How | 仕組みと設定の詳細。設定を変える人・原因を調べる人が読む |
| 運用手順（`docs/runbook/`、scripts の `--help`） | When + How | どの状況で、何をどの順で実行するか |
| API ドキュメント・仕様 | What + When | 何を返すか、どの条件で呼ぶか・失敗するか |
| README | What + How to start | 何のためのものか、最初に何をすれば動くか |
| ユーザー向けガイド | How + What for | どう使うか、それで何ができるか |
| 作業メモ・中断時の引き継ぎ | What next | 次に何をするか |
| 本書（AGENTS.md / CLAUDE.md） | When + How | 作業のたびに必要な手順とルールだけ。一部の作業でしか読まない詳細は docs に置いて上の表から参照する |

> 運用手順だけは重複を許す。障害対応中の読み手はリンクを辿る余裕がないため、
> 手順は参照先を読まなくても実行できるように書く。

## タスク管理

作業中にタスクのスコープ外として先送りにするタスク・課題はgithubのissueに登録することをユーザーに提案してください。
