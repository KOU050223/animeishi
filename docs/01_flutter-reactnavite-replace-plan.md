# Animeishi フルリライト計画: 新規リポジトリ方式 + TDD

## Context

現行の Animeishi は Flutter 3.29.0 + Firebase (Auth/Firestore/Storage/Functions) で Web のみ公開中。ユーザーは Flutter 保守がつらく、**新規リポジトリ** で React Native (Expo) + RDB 一本化 + cron 整備として作り直したい。既存 Flutter は Web のみなのでストアへの影響なく、切替時に Hosting を差し替えるだけでリリースを引っ込められる。

ゴール:
- iOS / Android / Web の 3 プラットフォームを Expo で一本化
- **新規リポジトリ** で作る（既存 Animeishi リポジトリとは分離、Firebase → RDB 移行スクリプトだけ既存ツリーに置く）
- **TDD**: 機能の受け入れ基準 → テスト → 実装の順
- アニメマスタ更新 / シーズン情報 / メンテナンスの cron 整備
- データ量試算で Supabase Free が厳しいと判明したため、**DB/Auth 選定を見直し**

非ゴール:
- 既存 Flutter の機能追加や保守延長
- 新旧の長期並行運用（Flutter Web は RN Web リリース時に撤退）

---

## データ量試算（Supabase Free の実力判定）

Explore 調査に基づく試算。現状設計をそのまま移植すると **Supabase Free は数百 MAU で破綻** する。

| 項目 | Supabase Free | 想定消費 | 限界 MAU |
|---|---|---|---|
| DB | 500 MB | 平均 50KB/user（正規化前）, 10KB/user（正規化後） | 10,000 / 50,000 |
| Auth | 50k MAU | — | 50,000 |
| Storage | 1 GB | 500 KB/user（名刺+プロフィール） | **2,000** |
| Egress | **5 GB/月** | 現設計は 1 セッションで `titles` 全件 21MB × 2 画面 = 40MB | **200 MAU × 月5セッション** |
| Edge Functions | 500k / 月 | Gemini 傾向分析 1 回/user | 余裕 |

ホットスポット:
- `AnimeListPage` / `WatchListPage` が `titles` コレクションを**全件 get**（`lib/ui/animes/view_model/anime_list_view_model.dart` L434-436）。titles が数万件になると 1 画面表示で数十 MB。
- `SNSPage` が friends の `users/{id}` を **N+1 クエリ** で取得。
- 名刺画像 100〜250KB / プロフィール画像 150〜300KB。

対策を入れれば Free で数千 MAU は可能だが、**titles を毎回フェッチしない設計**と **画像の追加圧縮 (WebP/512px/q70 → 50KB)** が前提。

### 結論: スタック見直し

**採用**: **Cloudflare D1 + R2 + Workers + Clerk** 構成に変更。

| 層 | 採用 | 理由 |
|---|---|---|
| RDB | **Cloudflare D1**（SQLite ベース） | **Free で 1 DB あたり 10GB**（Paid は 50GB）/ 500 万行読取/日 / 10 万行書込/日。titles を D1 に入れ、`Cache API` で CDN エッジキャッシュすれば実 Egress をほぼ消せる |
| オブジェクト | **Cloudflare R2** | Free 10GB ストレージ、**Egress 無料**。画像に最適 |
| API | **Hono on Cloudflare Workers** | 10万リクエスト/日 Free、TypeScript、Expo Web からの同一オリジン配信も容易 |
| 認証 | **Clerk** | Free 10,000 MAU、Expo 公式サポート、既存 Firebase Auth からの移行 API あり、React Native と Expo Web 両対応 |
| バッチ | **Cloudflare Workers Cron Triggers** | Workers の機能としてそのまま使える、追加課金なし |
| アプリ | **Expo SDK 最新 + Expo Router** | 決定済み |
| UI | **NativeWind v4** | Web/Native 共通 |
| 状態 | **TanStack Query + Zustand** | サーバ/UI を分離 |

第二候補（Clerk MAU 上限を超える or 自前管理したい場合）:
- 認証: **Firebase Auth 継続**（既存ユーザーをそのまま持ち越せる。Workers 側で Firebase Admin JWT 検証）
- RDB: **Turso**（SQLite 互換、Free で 9GB、複数リージョン）

不採用:
- **Supabase**: Egress 5GB/月 が致命的。titles 同期 + 画像で数百 MAU で破綻。Realtime/PostgREST の恩恵より制約の方が重い。
- **TiDB Serverless**: 日本リージョンあり・無料枠大きいが、cron / Storage / 認証を別途そろえる必要があり運用面が Cloudflare 一式に劣る。
- **Neon / PlanetScale**: 前者は日本リージョン無し、後者は Free 廃止。
- **Cloud SQL**: 常時課金。

---

## 新リポジトリの構成

**新規リポジトリ**を切り、既存 Animeishi ツリーは移行スクリプトと Flutter 資産のみ残す。

新規リポジトリ（仮称 `animeishi-next`）:
```
animeishi-next/
├── apps/
│   └── mobile/                 # Expo (iOS/Android/Web)
│       ├── app/                # Expo Router
│       ├── components/
│       ├── lib/
│       ├── __tests__/          # RTL + Jest
│       └── package.json
├── services/
│   └── api/                    # Hono on Cloudflare Workers
│       ├── src/
│       │   ├── routes/
│       │   ├── db/             # D1 schema, Drizzle
│       │   ├── cron/           # scheduled handlers
│       │   └── index.ts
│       ├── test/               # Vitest + Miniflare
│       ├── wrangler.toml
│       └── package.json
├── packages/
│   ├── schema/                 # Zod スキーマ（mobile/api 共有）
│   └── contracts/              # API 型定義
├── .github/workflows/
│   ├── ci.yml                  # lint + test (apps/mobile, services/api)
│   ├── eas-preview.yml
│   └── workers-deploy.yml
├── pnpm-workspace.yaml
└── turbo.json
```

既存 `/Users/uozumikouhei/workspace/Animeishi/Animeishi/` は触らず残し、**移行専用スクリプト** のみ:
```
/Users/uozumikouhei/workspace/Animeishi/Animeishi/
└── scripts/migrate/
    ├── export-firestore.ts     # Firestore → JSON 吐き出し
    ├── export-storage.ts       # GCS → ローカル
    └── import-to-d1.ts         # JSON → D1 + R2
```

Flutter Web は RN Web リリース時点で `firebase.json` の deploy 対象を差し替えて撤退。

---

## D1 スキーマ（SQLite / Drizzle）

```typescript
// services/api/src/db/schema.ts
export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),                // Clerk user id
  legacyFirebaseUid: text('legacy_firebase_uid').unique(),
  email: text('email').notNull(),
  username: text('username').notNull(),
  selectedGenres: text('selected_genres', { mode: 'json' }).$type<string[]>().default([]),
  meishiImageKey: text('meishi_image_key'),   // R2 object key
  profileCustomization: text('profile_customization', { mode: 'json' }).default({}),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const titles = sqliteTable('titles', {
  tid: text('tid').primaryKey(),
  title: text('title').notNull(),
  titleYomi: text('title_yomi'),
  firstYear: integer('first_year'),
  firstMonth: integer('first_month'),
  comment: text('comment'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const watchHistories = sqliteTable('watch_histories', {
  userId: text('user_id').references(() => profiles.id, { onDelete: 'cascade' }).notNull(),
  tid: text('tid').references(() => titles.tid, { onDelete: 'cascade' }).notNull(),
  watchedAt: integer('watched_at', { mode: 'timestamp' }).notNull(),
}, t => ({ pk: primaryKey({ columns: [t.userId, t.tid] }) }));

export const favorites = sqliteTable('favorites', { /* watchHistories と同形 */ });

export const friendships = sqliteTable('friendships', {
  userId: text('user_id').notNull(),
  friendId: text('friend_id').notNull(),
  scannedAt: integer('scanned_at', { mode: 'timestamp' }).notNull(),
}, t => ({ pk: primaryKey({ columns: [t.userId, t.friendId] }) }));
```

権限は D1 に RLS が無いため **Workers 側で都度認可チェック**（Clerk JWT から userId 取得 → クエリの `where user_id = ?` を強制）。DSL ラッパ `authorizedDb(userId)` を書いてクエリヘルパを通さないとアクセスできない作りにする。

---

## 横断的な実装方針（レビュー反映）

### 画像最適化（R2 補完）
R2 は Egress 無料だが、自動画像変換はない（Cloudflare Images は別課金）。**クライアント側で `expo-image-manipulator` により WebP / 512px / q70 にリサイズしてから R2 に PUT** する工程を必ず挟む。目標: 1 枚 50KB 以下。Web では `react-native-web` 側で同 API が動くので共通化可能。旧 Flutter 相当（プロフィール 1024×q80 / 名刺 800×q90）より積極的に圧縮する。

### Drizzle スキーマは共有 Zod の源泉にする
`drizzle-zod` で D1 スキーマから Zod を自動生成し、`packages/schema` から mobile / api 両方に配る。mobile のフォームバリデーションは `react-hook-form` + 同じ Zod を使う。これで型パズルを最小化し、DB スキーマ変更が自動で全層に伝搬する。

### リポジトリ層でユーザー ID を強制
`authorizedDb(userId)` だけでなく、Drizzle で **高階関数ベースのリポジトリ** を作る（例: `profileRepo(userId).update(...)` は内部で `where(eq(profiles.id, userId))` を必ず付ける）。生 `db.update(profiles)` を呼ぶコードは CI で禁止（ESLint `no-restricted-syntax` + grep）。

### CDN キャッシュの Purge
`GET /titles` のキャッシュは TTL 24h だが、`cron/anime-sync` / `cron/season-sync` が D1 を更新したら **Cron ハンドラ末尾で Cloudflare API を叩いて該当エンドポイントを Purge** する。これで cron → 数秒後にクライアントが最新を取得できる。

### カメラの制御
`expo-camera` は `<Camera>` がマウントされっぱなしだとリソースを食う。`@react-navigation/native` の `useIsFocused` を噛ませて、タブがアクティブな時のみレンダリング・非アクティブで unmount する。

### E2E の範囲
- **RNTL + Jest**: 結合テストまではここで網羅（受け入れ基準 ~90 件の大半）
- **Playwright (Web)**: `/sign-in` → 視聴追加 → `/user/[uid]` 公開表示までの主要ゴールデンパスのみ
- **Detox は導入しない**（個人開発のスケジュールリスクが大きすぎる）。将来 MAU 規模が増え回帰リスクが上がったら再評価する

### OGP / SEO（公開ページ）
`app/user/[uid].tsx` は未ログイン閲覧があるため Expo Router の Web 出力だけだと動的 OGP が作れない。**Hono 側に `GET /users/:id` の Web（`Accept: text/html`）向けレンダラを置き、OGP 付き静的 HTML を返す**（SPA への bootstrap タグを同梱）。クローラはここで完結、ユーザーは JS 起動後 SPA に遷移。

---

## API 設計（Hono on Workers）

- `GET /titles` — `Cache API` で CDN エッジ 24h キャッシュ。titles 全件レスポンスは gzip で ~1MB 想定、CDN ヒットすればオリジン負荷ゼロ。**cron 実行末尾で同 URL を Purge** する
- `GET /titles/:tid`
- `GET /me/watch-histories`, `POST /me/watch-histories`, `DELETE /me/watch-histories/:tid`
- `GET /me/favorites`, `POST /me/favorites`, `DELETE /me/favorites/:tid`
- `GET /me/friends`, `POST /me/friends` (QR スキャン後の双方向 upsert), `DELETE /me/friends/:id`
- `GET /users/:id` — 公開プロフィール（旧 viewer 相当、未認証可、`is_public` で制御）。`Accept: text/html` の時は OGP 付き HTML を返す
- `GET /users/:id/watch-histories` — 公開条件を満たす場合のみ返却
- `POST /analysis/gemini` — 既存 `functions/src/index.ts` 相当、Gemini API プロキシ

Cron Triggers (wrangler.toml):
- `0 18 * * *` (03:00 JST) — `cron/anime-sync` — しょぼいカレンダー / Annict から titles upsert
- `0 18 1 * *` — `cron/season-sync` — 新クール一覧
- 手動は `wrangler cron trigger --name maintenance` or GitHub Actions `workflow_dispatch`

---

## TDD 的実装戦略

### 0. 受け入れ基準マスタを作る
`packages/schema/acceptance/*.md` に以下カテゴリで **入力 → 期待結果** の列を書き出す。これをテスト 1:1 対応させる。調査で既に洗い出し済み（合計 ~90 件）:

- 認証（サインアップ/サインイン/リセット/削除/バリデーション）: 18 件
- アニメ一覧 / 検索 / ソート: 12 件
- お気に入り: 6 件
- 視聴履歴 / Watch 画面: 5 件
- QR 生成: 6 件
- QR スキャン / フレンド追加: 10 件
- SNS / フレンド一覧 / 削除: 6 件
- プロフィール編集 / 画像: 10 件
- 名刺 (Home): 6 件
- Viewer 公開ページ: 5 件
- Gemini 傾向分析: 6 件

### 1. 既存テストの流用判定
`/Users/uozumikouhei/workspace/Animeishi/Animeishi/test/` のうち:
- `validators_test.dart` — Zod に移植（`packages/schema`）
- `error_handler_test.dart` — エラーマッピング辞書として再利用
- `firestore_rules_test.js` / `storage_rules_test.dart` — **Workers 認可テスト**（Vitest + Miniflare）の allow/deny ケースにそのまま対応付け
- `qr_image_service_test.dart` — `react-native-qrcode-svg` のプロパティテストとして受け入れ基準を流用
- `navigation_test.dart` / `widget_test.dart` — RTL で書き直し（仕様のみ流用）

### 2. テスト先行の手順
各フェーズで:
1. 受け入れ基準から失敗するテストを書く（RED）
2. 最小実装でパス（GREEN）
3. リファクタ（REFACTOR）
4. CI で回るまで次に行かない

### 3. テスト層
- **schema テスト** (`packages/schema/__tests__`): Zod による入力バリデーション
- **API 単体** (`services/api/test`): Vitest + Miniflare で D1 in-memory、Hono ルート単位
- **API 認可テスト**: 旧 firestore.rules テストと同等の allow/deny
- **mobile 単体** (`apps/mobile/__tests__`): Jest + React Native Testing Library
- **E2E** (最終フェーズ): **Playwright for Web のみ**。Detox は採用しない（CI 安定化コスト過大）
- RLS が無い代わりに、**API 認可テスト**を最重要視する（RLS 相当の保証責任が Workers に集中するため）

---

## 実装フェーズ（Stacked PR 14 本に分割）

`/Users/uozumikouhei/workspace/Animeishi/docs/02_pr-split-plan.md` の方針に従い、**Stacked PRs** で進める。各 PR は 1 つ前のブランチをターゲットにし、レビュー単位を小さく保つ。PR タイトルには `[N/14]` の連番を入れ、本文に依存 PR を明記する。**全 PR で「受け入れ基準に対応するテスト RED→GREEN」と CI 緑を必須**にする。

マージ運用ルール（`docs/02_pr-split-plan.md` 抜粋）:
- PR 1 は `main` ターゲット、PR N は PR N-1 ブランチをターゲット
- 下位 PR に修正が入ったら直ちに上位ブランチへ merge / rebase
- マージは古い順から。PR N-1 が main にマージされたら PR N のターゲットを main に切替
- Squash and merge の場合は `git rebase --onto main <旧Base> <現在のブランチ>` が必要なケースあり

### Phase 0: 準備・スキーマ定義
**PR 1 [1/14]: モノレポ基盤とスキーマ定義**
- 内容: `animeishi-next` リポジトリ作成、pnpm workspace + turbo セットアップ、`packages/schema` を作成
- 実装: 受け入れ基準 ~90 件を `packages/schema/acceptance/*.md` に起票、`validators.dart` から Zod へ移植、`drizzle-zod` 連携の雛形
- テスト: Vitest で Zod 入力バリデーションテスト
- 完了条件: `pnpm test` が `packages/schema` で緑、CI が動く

### Phase 1: API 基盤と認証
**PR 2 [2/14]: Hono API 基盤と D1/Drizzle セットアップ**
- 内容: `services/api` 初期化、Wrangler + Miniflare ローカル D1 起動
- 実装: Drizzle で `profiles` / `titles` / `watch_histories` / `favorites` / `friendships` 定義、`authorizedDb(userId)` + リポジトリ層、生 `db.update(...)` を禁止する ESLint ルール
- テスト: Vitest + Miniflare で D1 アクセス単体テスト、リポジトリ層経由でのみ書き込めることを assertion
- 完了条件: ローカルで migration が走り、リポジトリ経由のみ通る

**PR 3 [3/14]: Clerk 認証とプロフィール API**
- 内容: Hono に Clerk JWT 検証ミドルウェア追加
- 実装: `GET /me/profile`, `PUT /me/profile` を TDD（受け入れ基準: 認証 18 件のうちプロフィール関連）
- テスト: 認可テスト（正しい JWT → 200, 不正/無し → 401）
- 完了条件: 認可テスト緑、`workers-deploy.yml` で `wrangler deploy --dry-run` 通過

### Phase 2: モバイル基盤
**PR 4 [4/14]: Expo 基盤とサインアップ UI**
- 内容: `apps/mobile` を `create-expo-app` でブートストラップ、Expo Router / NativeWind / TanStack Query / Zustand / Clerk Expo SDK 導入
- 実装: ClerkProvider + QueryClientProvider、サインイン / サインアップ / パスワードリセット画面
- テスト: RNTL で認証フローを Mock API でテスト
- 完了条件: 3 プラットフォームでサインアップ → `profiles` に行が入る、認証受け入れ基準 18 件緑

### Phase 3: コア機能（アニメ一覧と履歴）
**PR 5 [5/14]: アニメ一覧 API とローカルキャッシュ**
- 内容: `GET /titles`（Cache API で CDN 24h キャッシュ）+ モバイル側表示
- 実装: API 側で gzip + Cache、mobile 側で TanStack Query + `persistQueryClient` で AsyncStorage 永続化、一覧 / 検索 / ソート UI
- テスト: API レスポンステスト、検索 / ソートロジックの単体テスト
- 完了条件: アニメ一覧受け入れ基準 12 件緑、ローカル表示 200ms 以内

**PR 6 [6/14]: 視聴履歴と Watch 画面**
- 内容: 視聴記録 CRUD
- 実装: `GET/POST/DELETE /me/watch-histories`、WatchListPage / WatchAnimePage、500件超は分割書込
- テスト: 視聴追加・削除・並び順の受け入れテスト
- 完了条件: 視聴 5 件緑

**PR 7 [7/14]: お気に入り機能**
- 内容: お気に入り CRUD
- 実装: `GET/POST/DELETE /me/favorites`、星マーク UI 連動
- テスト: 追加・削除・未認証時の振る舞い
- 完了条件: お気に入り 6 件緑

### Phase 4: ソーシャル機能
**PR 8 [8/14]: QR コード生成とスキャン（カメラ制御）**
- 内容: 名刺交換コア
- 実装: `react-native-qrcode-svg` で生成（旧 URL フォーマット互換）、`expo-camera` で 3 種類（旧 URL / `animeishi://` / 28文字 UID）の parse、`useIsFocused` でカメラ unmount、Web は `@zxing/browser` フォールバック
- テスト: parser の単体テスト（QR 6 件 + スキャン 10 件）
- 完了条件: QR 受け入れ基準 16 件緑

**PR 9 [9/14]: フレンド機能と SNS タイムライン**
- 内容: スキャン後の双方向登録と一覧
- 実装: `POST /me/friends` 双方向 upsert + 認可、`GET /me/friends` を join で N+1 回避、SNS 画面、フレンド削除（片方向）
- テスト: 双方向登録 / 自己スキャン拒否 / 既存フレンド検出 / 削除
- 完了条件: SNS 6 件緑、実機 2 台で双方向スキャン成立

**PR 10 [10/14]: プロフィール画像圧縮と名刺 UI**
- 内容: R2 画像アップロード + 名刺描画
- 実装: `expo-image-manipulator` で WebP / 512px / q70 → R2 pre-signed URL PUT、`PUT /me/profile/meishi-image`、`react-native-gesture-handler` + `reanimated` でピンチズーム
- テスト: 圧縮後サイズが 50KB 以下、画像 URL が `profiles.meishi_image_key` に反映
- 完了条件: プロフィール 10 + 名刺 6 件緑

### Phase 5: 公開・バッチ・AI
**PR 11 [11/14]: Web 公開ページと動的 OGP 生成**
- 内容: 未ログイン閲覧用ビューア（旧 `viewer/` 置換）
- 実装: Expo Router `app/user/[uid].tsx`、Hono 側で `Accept: text/html` 判定し OGP 付き静的 HTML 返却、SPA bootstrap タグ同梱
- テスト: Playwright Web E2E で OGP / 視聴履歴表示確認
- 完了条件: viewer 受け入れ基準 5 件緑

**PR 12 [12/14]: Gemini 分析 API の移植**
- 内容: 視聴傾向分析
- 実装: 旧 `functions/src/index.ts` を Hono `POST /analysis/gemini` に移植、CORS / OPTIONS / fallback メッセージ維持
- テスト: モックレスポンステスト、入力バリデーション
- 完了条件: Gemini 6 件緑

**PR 13 [13/14]: Cron トリガーとキャッシュパージ**
- 内容: アニメマスタ / シーズン情報の定期同期
- 実装: Workers Cron Triggers (`anime-sync` 毎日 03:00 JST、`season-sync` 月次)、しょぼいカレンダー / Annict 取得、UPSERT、ハンドラ末尾で Cloudflare API による `GET /titles` Purge
- テスト: バッチ単体テスト（手動 wrangler cron trigger で実行確認）、Purge 呼び出しのモックテスト
- 完了条件: cron 実行ログが Workers dashboard で確認できる、Purge 後の `GET /titles` が新データを返す

### Phase 6: データ移行（旧リポジトリ側）
**PR 14 [14/14]: 移行スクリプト（旧リポジトリで作成）**
- 場所: `/Users/uozumikouhei/workspace/Animeishi/Animeishi/scripts/migrate/`（こちらは旧リポジトリで PR）
- 内容: Firebase → Cloudflare/Clerk のデータ移行
- 実装:
  - `export-firestore.ts` — Firestore 全コレクションを JSON
  - `export-storage.ts` — GCS から画像をダウンロード、`@cf-wasm/photon` で WebP/512px 一括変換
  - `import-to-d1.ts` — JSON → D1 / R2 へインポート（`legacy_firebase_uid` 保存、`meishi_image_key` 更新）
  - **Spike**: 本番前に Firebase Scrypt ハッシュパラメータ（Signer Key / Salt Separator / Rounds / Mem Cost）取得 → `firebase auth:export` JSON を Clerk インポート API に流し、テストアカウントで旧パスワードログイン成立を確認
- テスト: 開発環境 D1/R2 でスクリプト完走、行数 / オブジェクト数の欠損 0
- 完了条件: 開発環境で全データ移行検証完了、Spike アカウントが旧パスワードで Clerk ログイン成功

### Phase 7: 切替 / Flutter 撤退（リリース運用）
PR ではなく運用作業として実施:
- 本番移行（メンテ 2 時間想定）→ Sentry 1 週間監視
- Expo Web を Cloudflare Pages にデプロイ、独自ドメイン `animeishi.uomi.site` を移管
- 既存 Flutter `firebase.json` を no-op、`animeishi-viewer.web.app` は 30 日リダイレクト
- 30 日後に旧 Firebase プロジェクトの Firestore / Storage / Functions を削除

---

## critical files

### 既存（参照元）
- `/Users/uozumikouhei/workspace/Animeishi/Animeishi/lib/model/factory/anime_list_factory.dart` — titles シード起点
- `/Users/uozumikouhei/workspace/Animeishi/Animeishi/lib/ui/animes/view_model/anime_list_view_model.dart` — titles 全件 get のホットスポット L434-436
- `/Users/uozumikouhei/workspace/Animeishi/Animeishi/lib/ui/camera/view/qr_page.dart` — QR parse 3 方式
- `/Users/uozumikouhei/workspace/Animeishi/Animeishi/lib/utils/validators.dart` — Zod 移植の原本
- `/Users/uozumikouhei/workspace/Animeishi/Animeishi/lib/utils/error_handler.dart` — エラーマッピング原本
- `/Users/uozumikouhei/workspace/Animeishi/Animeishi/firestore.rules` / `storage.rules` — 認可テストの原本
- `/Users/uozumikouhei/workspace/Animeishi/Animeishi/functions/src/index.ts` — Gemini プロキシ移植元
- `/Users/uozumikouhei/workspace/Animeishi/Animeishi/viewer/public/user.html` / `app.js` — 公開ページ仕様
- `/Users/uozumikouhei/workspace/Animeishi/Animeishi/test/validators_test.dart`, `error_handler_test.dart` — 先行移植テスト

### 新規（作成）
- `animeishi-next/packages/schema/src/*.ts` — Zod
- `animeishi-next/services/api/src/index.ts` — Hono 起点
- `animeishi-next/services/api/src/db/schema.ts` — Drizzle
- `animeishi-next/services/api/wrangler.toml` — D1 binding + Cron Triggers
- `animeishi-next/apps/mobile/app/_layout.tsx` — ClerkProvider + QueryClient
- `animeishi-next/apps/mobile/app/(tabs)/_layout.tsx` — BottomNav / Sidebar 分岐
- `animeishi-next/apps/mobile/lib/api.ts` — TanStack Query hooks

---

## 検証方法（E2E）

### ローカル開発
- `pnpm --filter api dev` で Wrangler + Miniflare + D1 ローカル
- `pnpm --filter mobile start` で Expo 起動、iOS/Android/Web 同時
- `pnpm test` でリポジトリ全体のテスト

### CI
- `ci.yml`: schema / api / mobile のテストを並列実行、`wrangler deploy --dry-run`
- `eas-preview.yml`: PR で preview ビルド
- `workers-deploy.yml`: main マージで `wrangler deploy`

### 本番シナリオ（Phase 5 終了時）
- 2 台実機で QR 交換 → 双方の friendships に行
- 未ログインブラウザで `/user/{uid}` アクセスし公開履歴表示
- Gemini 傾向コメントが 100 文字前後で返る
- Cron Trigger ログで anime-sync が毎日走っている

### データ量モニタ
- Cloudflare dashboard で D1 行数 / R2 ストレージ / Workers リクエスト数を週次チェック
- 80% 到達時に Turso / R2 Pro / Workers Paid 検討

---

## リスクと留意点

- **Clerk MAU 10,000 超過**: 月 $25 + $0.02/MAU。超える見込みなら Firebase Auth 継続に切替（Workers 側は JWT 検証ライブラリを差し替えるだけ）
- **D1 サイズ**: Free でも 1 DB 10GB、Paid で 50GB。titles + users ともに数 GB 規模までは分割不要、当面シャーディング不要
- **D1 のリージョン**: 書込は単一リージョン（自動割当）。日本からの書込レイテンシは数百 ms 許容
- **RLS が無い**: 認可ミスが即データ漏洩。`authorizedDb(userId)` + リポジトリ層 + ESLint で多層防御。認可テストをカバレッジ 100%
- **Clerk への Firebase 移行**: Clerk は **Firebase Scrypt をネイティブサポート**。`firebase auth:export` の JSON + Firebase プロジェクトのハッシュパラメータ（Signer Key / Salt Separator / Rounds / Mem Cost）を Clerk に食わせればシームレス。Phase 5 冒頭で Spike 検証を入れる
- **R2 の画像最適化不在**: Cloudflare Images は別課金。クライアント側 `expo-image-manipulator` で WebP/512px/q70 圧縮を必須化
- **CDN キャッシュの鮮度**: `GET /titles` の TTL 24h。cron で D1 更新後に **Cloudflare API で Purge** する。Purge 失敗時のフォールバックとしてレスポンスに `Vary` と `ETag` も併用
- **Flutter Web 切替タイミング**: Hosting を差し替えた瞬間に旧ユーザーセッションが失効。告知バナー 2 週間 + メール 1 回
- **Cloudflare ベンダロック**: D1 は SQLite なので `sqlite3` でダンプ可、R2 は S3 互換でエクスポート可、Workers は Hono なら Vercel/他ランタイムへ移植容易
- **Expo Go の制約**: Clerk Expo SDK は Expo Go 可、`expo-camera` も可。本番は EAS Build
- **カメラのライフサイクル**: `expo-camera` は `useIsFocused` で unmount 制御しないとリソース食い潰し。Phase 4 で必須対応
