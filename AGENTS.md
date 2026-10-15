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
* db:migrate:prod:list:   本番 D1 の未適用マイグレーションを確認（非破壊）
* db:migrate:prod:        本番 D1 にマイグレーション適用（破壊的操作あり・確認プロンプト付き）

> 本番 D1 へのマイグレーション適用は deploy-api.yml がデプロイ前に自動で行うため、
> main へのマージ後に手動で `task db:migrate:prod` を実行する必要はない。
> 手動タスクは手動デプロイ時や DB 再作成時のリカバリ用途で残してある。
* dev:api:                Cloudflare Workers API を起動 (wrangler dev)
* dev:mobile:             Expo モバイルアプリを起動
* e2e:ios:                iOS シミュレーターで Maestro E2E を実行
* reports:list:           本番 D1 の通報一覧を表示（既定: 未対応のみ。issue #186）
* reports:resolve:        本番の通報を対応済みにする（確認プロンプト付き）
* reports:dismiss:        本番の通報を却下する（確認プロンプト付き）
* reports:reopen:         本番の通報を未対応に戻す（確認プロンプト付き）
* reports:list:local:     ローカル D1 の通報一覧を表示
* reports:update:local:   ローカル D1 の通報ステータスを更新（動作確認用）
```

> 通報モデレーション（reports.*）は `services/api/scripts/reports.sh` の
> Taskfile ラッパー。使い方は `bash services/api/scripts/reports.sh --help`。
> `task reports:list -- --status all`、`task reports:list -- --by-user` のように
> `--` 以降でオプションを渡せる。プレビュー D1 を見る場合は
> `bash services/api/scripts/reports.sh --env preview list` を直接叩く。

> wrangler は `services/api/node_modules` にのみ入っている（flake/ルートには入れない方針）。
> ルートから叩くときは `dir: services/api` 付きの task 経由にする。デプロイ・本番 D1 操作は
> 上記 `db:migrate:prod*` のように Taskfile に集約し、wrangler の場所を意識せず実行できるようにする。

> CI の "Lint & Type Check" ジョブは **ESLint と型チェック (tsc --noEmit) の 2 段**で構成される。
> `task lint` は ESLint だけで型エラーは拾えない。push 前は必ず `nix develop --command task typecheck`
> （または `task test` と併せて）を実行して CI 落ちを未然に防ぐこと。lefthook の pre-push でも自動実行される。
> （devShell 内なら `task typecheck` を直接実行してよい。下記「開発環境」を参照）

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

## E2E テスト（Maestro / iOS シミュレーター）

Maestro による E2E を `apps/mobile/.maestro/` に置く。
第 1 弾の対象は認証ライフサイクル（サインアップ→ホーム→サインアウト→
サインイン→アカウント削除）で、`flows/auth-lifecycle.yaml` がエントリポイント。
`subflows/` は `runFlow` から呼ばれる部品なので直接実行しない。

```bash
task e2e:ios
```

`task e2e:ios`（`apps/mobile/scripts/e2e-ios.sh`）が行うこと:

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
  アカウント削除は `DELETE /me` を叩くため API が必須（`services/api/.dev.vars`
  に開発インスタンスの `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` が要る）
- ローカル D1 マイグレーション済みであること（`task db:migrate:local`。
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

> Nix devShell 内で xcodebuild を呼ぶと toolchain 変数（`CC` `SDKROOT`
> `DEVELOPER_DIR` `NIX_*` 等）がネイティブビルドを壊す。e2e-ios.sh は全コマンドを
> `env -u ...` と `PATH=/usr/bin:/bin:...` 経由で実行するため、devShell 内外どちらでも動く。
> 手動で xcodebuild / pod / simctl を叩くときも同じ unset が必要。

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
