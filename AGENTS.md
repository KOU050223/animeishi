# AGENTS.md

## コマンド実行

Taskfile.yml に定義されたタスクを実行するには、以下のコマンドを使用する。

```bash
task <タスク名>
```

以下は、利用可能なタスクの一覧
```
* build:                  全パッケージをビルド
* dev:                    全アプリの開発サーバを起動 (turbo)
* format:                 フォーマット
* lint:                   Lint
* setup:                  依存インストール + Git hooks 設置
* test:                   テスト
* db:migrate:local:       D1 ローカルマイグレーション適用
* dev:api:                Cloudflare Workers API を起動 (wrangler dev)
* dev:mobile:             Expo モバイルアプリを起動
```

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
