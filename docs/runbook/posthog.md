# PostHog（プロダクト計測・機能フラグ）の運用

PostHog のプロジェクトを用意するとき、運営 AI（muse）に分析を任せるとき、
障害時に d アニメ取り込みを止めるときに読む。仕組みは
`docs/08_observability-design.md` の「プロダクト計測（PostHog）」節。

キー（`EXPO_PUBLIC_POSTHOG_KEY` / `POSTHOG_KEY`）が未登録の間は、アプリ・API とも
計測を何もしない（no-op）。機能フラグも「止めない」扱いになる。

## 初期設定（初回のみ）

### 1. プロジェクトを作る

1. <https://app.posthog.com/signup> でアカウントを作る（US Cloud を選んだ場合の取り込み
   ホストは `https://us.i.posthog.com`、EU Cloud なら `https://eu.i.posthog.com`）
2. プロジェクト `animeishi` を作る
3. Project settings で次を設定する（プライバシー申告と合わせるため）
   - **Discard client IP data** を ON（IP を保存しない）
   - **Autocapture**（Web / モバイル）・**Session replay**・**Heatmaps**・**Surveys** を OFF
     （SDK 側でも無効にしているが、プロジェクト側でも止めておく）
4. Project settings → **Project API key**（`phc_...`）を控える。クライアントに埋め込む
   公開値で、秘密ではない

### 2. キーを登録する

モバイル（EAS Build / EAS Update）:

```bash
cd apps/mobile
eas env:create --name EXPO_PUBLIC_POSTHOG_KEY --value phc_xxx \
  --environment production --environment preview --visibility plaintext
# EU Cloud のときだけ
eas env:create --name EXPO_PUBLIC_POSTHOG_HOST --value https://eu.i.posthog.com \
  --environment production --environment preview --visibility plaintext
```

Web（GitHub Actions の deploy-web.yml / preview-web.yml）:

```bash
gh variable set EXPO_PUBLIC_POSTHOG_KEY --body phc_xxx
# EU Cloud のときだけ
gh variable set EXPO_PUBLIC_POSTHOG_HOST --body https://eu.i.posthog.com
```

API（サーバー側の `sign_up_complete` / `exchange_complete`）:

```bash
cd apps/api
pnpm exec wrangler secret put POSTHOG_KEY --env production   # phc_xxx を入力
# EU Cloud のときだけ
pnpm exec wrangler secret put POSTHOG_HOST --env production  # https://eu.i.posthog.com
```

モバイルの値はビルド時に埋め込まれるため、登録後の EAS Build / EAS Update から有効になる。

### 3. 機能フラグを作る

Feature flags → New feature flag:

- Key: `danime_import_kill_switch`
- 条件: Release conditions を **0% of users**（= 常に false）で保存する
- 停止したいときだけ 100% にする（下の「d アニメ取り込みを止める」）

### 4. インサイトを作る

- 交換完了率: Funnel で `qr_exchange_start` → `exchange_complete`
  （Aggregating by: Unique users、`environment = production` で絞る）
- D1 / D7 リテンション: Retention で 初回イベント・再訪イベントとも `app_open`
  （Daily、`environment = production` で絞る）
- オンボーディング: Funnel で `sign_up_complete` → `meishi_create` →
  `annict_connect_complete`（d アニメは Web のみなので `danime_import_complete` は別インサイト）

## 運営 AI（muse）から参照する

PostHog の公式 MCP サーバーを muse のカスタムコネクタに登録する。
書き込みはさせず、読み取り専用のキーを使う。

1. PostHog → 右上のアカウント → **Personal API keys** → Create personal API key
   - Label: `muse-readonly`
   - Organization & project access: `animeishi` プロジェクトだけ
   - Scopes: **Read** だけを付ける（`insight:read` `query:read` `event_definition:read`
     `feature_flag:read` `person:read` 等。Write は付けない）
2. muse の設定 → カスタムコネクタ → 追加
   - URL: `https://mcp.posthog.com/mcp`（EU Cloud は `https://mcp-eu.posthog.com/mcp`）
   - 認証: API キー（`Authorization: Bearer <personal API key>`）
3. muse から「`app_open` の D7 リテンションを見せて」等を頼み、結果が返ることを確かめる

キーを漏らしたとき・muse の利用をやめるときは、同じ画面で Personal API key を削除する。

## d アニメ取り込みを止める（障害時）

d アニメ側の仕様変更・取り込みの不具合が起きたときに、アプリの更新を待たずに止める。

1. PostHog → Feature flags → `danime_import_kill_switch` → Release conditions を
   **100% of users** にして保存
2. 起動中のアプリには次のフラグ再取得（起動・サインイン時）から効く。取り込みの導線が消え、
   取り込み画面を直接開いても視聴履歴へ戻される
3. 復旧したら 0% に戻す

フラグを取得できない端末（オフライン等）では止まらない。止めることを保証する用途
（審査時だけ機能を隠す等）には使わない。
