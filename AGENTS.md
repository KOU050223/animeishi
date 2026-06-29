# AGENTS.md

## コマンド実行

Taskfile.yml に定義されたタスクを実行するには、以下のコマンドを使用する。

```bash
task <タスク名>
```

以下は、利用可能なタスクの一覧
```
* build:                  全パッケージをビルド
* typecheck:              型チェック (tsc --noEmit)。CI の "TypeScript check" 相当
* dev:                    全アプリの開発サーバを起動 (turbo)
* format:                 フォーマット
* lint:                   Lint
* setup:                  依存インストール + Git hooks 設置
* test:                   テスト
* db:migrate:local:       D1 ローカルマイグレーション適用
* dev:api:                Cloudflare Workers API を起動 (wrangler dev)
* dev:mobile:             Expo モバイルアプリを起動
```

> CI の "Lint & Type Check" ジョブは **ESLint と型チェック (tsc --noEmit) の 2 段**で構成される。
> `task lint` は ESLint だけで型エラーは拾えない。push 前は必ず `task typecheck`（または
> `task test` と併せて）を実行して CI 落ちを未然に防ぐこと。lefthook の pre-push でも自動実行される。

## 開発環境
開発環境は Nix で管理している。`task` や `pnpm` 等のツールは Nix devShell 経由で実行する。

```bash
nix develop --command task <タスク名>
```

例:
```bash
nix develop --command task setup   # 初回セットアップ（pnpm install + lefthook install）
nix develop --command task test    # テスト
nix develop --command task lint    # Lint
```

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
