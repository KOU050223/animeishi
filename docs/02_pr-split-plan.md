# Animeishi フルリライト：PR（Pull Request）分割戦略

本プロジェクトでは、巨大な変更を避けレビュー負荷を下げるために**「Stacked PRs（スタックドPR）」**の手法を用いて、依存関係のあるPRを順次積み重ねて開発・マージを行います。

## 基本ルールとマージ戦略（Stacked PRs）

1. **ターゲットブランチの連鎖**
   * PR 1は `main` をターゲット（Base branch）とする。
   * PR 2は PR 1のブランチをターゲットとする。
   * 以降、PR Nは PR N-1のブランチをターゲットとして順次作成する。
2. **依存関係の明記**
   * レビュアーが把握しやすいよう、PRタイトルに `[1/14]` のような連番を入れ、PR本文に「**このPRは #〇〇 (PR N-1) に依存しています**」と明記する。
3. **継続的な同期（追従）**
   * 下位のPR（例: PR 1）に修正コミットが入った場合は、直ちに上位のブランチ（例: PR 2）へ `merge` または `rebase` を行い、常に最新の変更を同期させる。
4. **マージ順序とターゲットの切り替え**
   * 必ず1番古いPR（`main`への差分となっているもの）から順にマージする。
   * PR N-1 が `main` にマージされた直後に、PR Nのターゲット（Base branch）を `main` に変更する。
   * *(注) `main` へのマージに「Squash and merge」を利用する場合は、コミット履歴が圧縮されるため、ターゲット変更後に上位ブランチで `git rebase --onto main <旧Base> <現在のブランチ>` が必要になる場合がある点に留意する。*
5. **テストとCI（必須）**
   * 各PRには必ず**「受け入れ基準に対応するテスト（RED → GREEN）」**を含め、CIが通った状態（緑）でマージすること。

---

## PR 依存関係ツリー

各 PR の作業開始前に、依存元のブランチが `main` にマージ済みか（またはローカルで同期済みか）を確認すること。

```
main
└── PR 1: モノレポ基盤・スキーマ定義
    └── PR 2: Hono API基盤・D1/Drizzle
        └── PR 3: Clerk認証・プロフィールAPI
            ├── PR 4: Expo基盤・サインアップUI
            │   └── PR 5: アニメ一覧API＋モバイルUI  ←(API側はPR2から)
            │       ├── PR 6: 視聴履歴
            │       │   └── PR 7: お気に入り
            │       │       └── PR 8: QRコード生成・スキャン
            │       │           └── PR 9: フレンド機能
            │       │               └── PR 10: プロフィール画像・名刺UI
            │       │                   ├── PR 11: Web公開・OGP
            │       │                   └── PR 12: Gemini分析API
            │       └── PR 13: Cronバッチ ←(API基盤PR2から独立可)
            └── PR 14: 移行スクリプト（旧リポジトリ）
```

---

## gh-stack を使った開発ワークフロー

本プロジェクトでは **`gh-stack`** スキル（`.agents/skills/gh-stack/`）を用いて、スタックドPRの作成・管理を行う。
依存関係ツリーの各 PR は、1つの gh-stack スタックに対応する。

### セットアップ（初回のみ）

```bash
# GitHub CLI 拡張機能のインストール
gh extension install github/gh-stack

# git 設定（インタラクティブプロンプト防止）
git config rerere.enabled true
git config remote.pushDefault origin
```

### 新しい PR の作業を始めるとき

依存元の PR が `main` にマージ済みであることを確認してから始める。

```bash
# 1. main を最新化
git checkout main && git pull

# 2. スタックを初期化（例: PR 4「Expo基盤・サインアップUI」の作業開始）
#    -p でプレフィックスを付けると、以降の add はサフィックスだけでよい
gh stack init -p feat pr4-expo-auth

# 3. コードを書いてコミット
git add <files>
git commit -m "feat: Expo基盤のセットアップ"

# 4. 次の層（PR 5 など）を同じスタックに追加する場合
gh stack add pr5-anime-list

# 5. プッシュしてドラフトPRを作成
gh stack submit --auto --draft

# 6. スタックの状態確認（必ず --json を付ける）
gh stack view --json
```

### 依存ツリーとスタック対応

依存関係ツリーの各行が 1 つの PR ＝ 1 つのブランチに対応する。
直列に並んでいる PR（例: PR 6 → PR 7 → PR 8）は、**1つのスタック**として積み上げることができる。
分岐している PR（例: PR 10 からの PR 11 と PR 12）は、**別々のスタック**として管理する。

```
# 直列スタックの例（PR 6〜9 を1スタックで管理）
main
 └── feat/pr6-watch-history   → PR #6
  └── feat/pr7-favorites      → PR #7
   └── feat/pr8-qr-code       → PR #8
    └── feat/pr9-friends      → PR #9

# 分岐スタックの例（PR 10 から PR 11 と PR 12 が分岐）
main
 └── feat/pr10-profile-card   → PR #10  ← まずこれを単独スタックで作成・マージ
      ↓ マージ後
      ├── feat/pr11-web-ogp   → PR #11  ← 別スタック A
      └── feat/pr12-gemini    → PR #12  ← 別スタック B
```

### 日常的な運用コマンド

| 操作 | コマンド |
|------|---------|
| スタック全体のリベース・同期 | `gh stack sync` |
| 下位ブランチを修正して上位へ伝搬 | `gh stack down` → コミット → `gh stack rebase --upstack` |
| squash merge 後の同期 | `gh stack sync`（自動検出）|
| スタックの再構成（順序変更など）| `gh stack unstack` → `gh stack init --adopt` |
| PRをマージする | ブラウザから行う（CLI非対応）|

### 注意事項

- **`gh stack view` は必ず `--json` を付ける**（付けないとTUIが起動して固まる）
- **`gh stack submit` は必ず `--auto` を付ける**（付けないとタイトル入力プロンプトが出る）
- **`gh stack init` / `add` / `checkout` には必ずブランチ名を渡す**（省略するとプロンプトが出る）
- サフィックスルール: `-p feat` でプレフィックスを設定した場合、`gh stack add auth` → `feat/auth` になる。`feat/auth` と渡すと `feat/feat/auth` になるので注意

---

## Phase 0: 準備・スキーマ定義
### PR 1: モノレポ基盤とスキーマ定義
* **内容**: pnpm workspace, turboの設定、`packages/schema` の作成。
* **実装**: Zodスキーマの定義、旧アプリからのバリデーションルールの移植、受け入れ基準のMarkdown追加。
* **テスト**: Zodの入力バリデーションテスト。

## クライアント-サーバー間通信方針: HonoRPC

すべての PR において、モバイル → API の通信は **HonoRPC**（`hono/client` の `hc<AppType>()`）で型安全に行う。

* `services/api/src/index.ts` でルートチェーンを `routes` 変数に束縛し `export type AppType = typeof routes` する
* `packages/contracts/src/index.ts` で `AppType` を re-export する（ランタイム依存なし）
* `apps/mobile` は `hc<AppType>(EXPO_PUBLIC_API_URL)` でクライアントを生成し、`$get` / `$post` / `$delete` を使う
* API ルートを追加・変更すると mobile 側の型エラーが即座に出るため、**手書きの型定義は不要**

---

## Phase 1: API基盤と認証
### PR 2: Hono API基盤とD1/Drizzleセットアップ
* **内容**: `services/api` の初期化、D1のローカル（Miniflare）環境構築。
* **実装**: Drizzleによるスキーマ定義、`authorizedDb` (リポジトリ層) の作成、直接DB更新を禁止するESLintルールの追加。`AppType` を export できる構造にしておく（ルートはチェーンで繋ぐ）。
* **テスト**: VitestでのDBアクセス単体テスト。

### PR 3: Clerk認証とプロフィールAPI（HonoRPC対応）
* **内容**: HonoのClerk JWT検証ミドルウェア追加。`packages/contracts` の初期化。
* **実装**: `GET /me/profile`, `PUT /me/profile` の作成。`AppType` を `packages/contracts` 経由でエクスポート。
* **テスト**: 認可テスト（正しいJWTならOK、不正・無しの場合は401を返すか）。

## Phase 2: モバイル基盤
### PR 4: Expo基盤とサインアップUI
* **内容**: `apps/mobile` の初期化、Expo Router, NativeWindの設定。
* **実装**: Clerk Expo SDK導入、サインイン/サインアップ画面の作成、`hc<AppType>()` で HonoRPC クライアントを生成する共通モジュール（`lib/api.ts`）の作成、QueryClient/Zustandの設定。
* **テスト**: React Native Testing Library (RNTL) による認証フローのモックテスト。

## Phase 3: コア機能（アニメ一覧と履歴）
### PR 5: アニメ一覧APIとローカルキャッシュ
* **内容**: D1からのアニメマスタ取得とモバイル側での表示。
* **実装**: `GET /titles` API（Cache API含む）、モバイル側は `hc<AppType>().titles.$get()` + TanStack Query + `persistQueryClient` で AsyncStorage 永続化、一覧表示・検索・ソートUI。
* **テスト**: モバイル側での検索・ソートのロジックテスト、APIのレスポンステスト。

### PR 6: 視聴履歴とプレビュー画面
* **内容**: アニメの視聴記録機能。
* **実装**: 視聴履歴のCRUD API、モバイル側は `hc<AppType>().me['watch-histories'].$get()` 等で呼び出し、WatchListPageを実装。
* **テスト**: 視聴追加・削除の受け入れテスト。

### PR 7: お気に入り機能
* **内容**: アニメのお気に入り登録機能。
* **実装**: お気に入りCRUD API、モバイル側は HonoRPC クライアントでUIへ反映。
* **テスト**: お気に入りの追加・削除テスト。

## Phase 4: ソーシャル機能
### PR 8: QRコード生成とスキャン（カメラ制御）
* **内容**: 名刺交換のコア機能。
* **実装**: QR生成UI、`expo-camera` を使ったスキャンUI（`useIsFocused` でのメモリ管理含む）。旧URLのパースロジック。
* **テスト**: QRのパースが正しく行われるかのロジックテスト。

### PR 9: フレンド機能とSNSタイムライン
* **内容**: QRスキャン後のフレンド登録と一覧表示。
* **実装**: `POST /me/friends` API（双方向 upsert）、N+1を避けたフレンド一覧取得、モバイル側は HonoRPC クライアントでUI実装。
* **テスト**: 双方向でのフレンド登録テスト。

### PR 10: プロフィール画像圧縮と名刺UI
* **内容**: R2への画像アップロードと名刺の描画。
* **実装**: `expo-image-manipulator` によるWebP圧縮処理、R2のPre-signed URLを利用したアップロード、Pinch&Zoom対応の名刺詳細ビュー。
* **テスト**: 画像圧縮ロジックが指定サイズ（512px）になるかのテスト。

## Phase 5: 公開・バッチ・AI
### PR 11: Web公開ページと動的OGP生成
* **内容**: 未ログインユーザー向けのビューアページ。
* **実装**: Hono側での `Accept: text/html` 判定とOGP付き静的HTMLの返却（HonoRPC 対象外 — ブラウザ直アクセスのため）、Expo Router Webの動的ルーティング (`app/user/[uid]`)。
* **テスト**: E2E (Playwright) による公開ページの表示テスト。

### PR 12: Gemini分析APIの移植
* **内容**: Geminiによる視聴傾向分析。
* **実装**: 旧Functionsからのロジック移植、`POST /analysis/gemini` エンドポイント作成、モバイルは HonoRPC クライアントで呼び出し。
* **テスト**: モックを用いた分析レスポンスのテスト。

### PR 13: Cronトリガーとキャッシュパージ
* **内容**: アニメデータの定期同期。
* **実装**: しょぼいカレンダー等からの同期バッチ（`anime-sync`, `season-sync`）、実行後のCloudflare Cache Purge処理。
* **テスト**: バッチ処理の単体テスト（手動トリガーでの実行確認）。

## Phase 6: データ移行（旧リポジトリ側）
### PR 14: 移行スクリプト（※これは旧リポジトリで作成）
* **内容**: FirebaseからCloudflare/Clerkへのデータ移行。
* **実装**: Firestore→JSON, Storage→ローカルダウンロート＆圧縮, D1/R2へのインポートスクリプト。Firebase Auth (Scrypt) のClerk移行検証。
* **テスト**: 開発環境のD1/R2に対してスクリプトが完走し、データが欠損していないかの確認。