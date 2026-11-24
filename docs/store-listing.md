# ストア掲載情報

アプリストア（App Store / Google Play）の掲載情報とスクリーンショット撮影手順のまとめ。

- **App Store**: [`apps/mobile/store.config.json`](../apps/mobile/store.config.json) でコード管理（EAS Metadata）。`eas metadata:push` で App Store Connect に反映する。
- **Google Play**: EAS Metadata は現時点で App Store のみ対応のため、この文書の文言を Play Console に手動で転記する。
- 文言の方針は [docs/archive/03](archive/03_next-actions-plan.md) の ASO 方針（機能ではなくベネフィットを前面に出す）に従う。

## 共通

| 項目 | 値 |
| --- | --- |
| アプリ名 | アニ名刺（英語圏: Animeishi） |
| プライバシーポリシー URL | https://animeishi.uomi.dev/privacy |
| 利用規約 URL | https://animeishi.uomi.dev/terms（App Store は標準 EULA、Play Console の各所やフッター参照用） |
| サポート URL | https://animeishi.uomi.dev/support（`apps/mobile/app/support.tsx`。未ログイン閲覧可。連絡先メールは `support@uomi.dev`（`apps/mobile/lib/legal/operator.ts`）） |
| カテゴリ | App Store: エンターテイメント（主）/ ソーシャルネットワーキング（副）。Play: エンターテイメント |

> dアニメストアからの視聴履歴取り込みは v1.0 からネイティブでも有効（#751。#158 の無効化を戻す）。
> 取り込み画面の WebView は遷移先を dアニメストアと dアカウント認証の docomo ドメインに限定し、
> それ以外のドメインは外部ブラウザで開く。仕組みは [docs/07](07_danime-import-design.md) を参照。

## 年齢レーティング（コンテンツの質問への回答）

App Store の年齢レーティング質問票は `store.config.json` の `advisory` に記述済み。Play 側の IARC アンケートも同じ方針で回答する。

| 質問 | 回答 | 根拠 |
| --- | --- | --- |
| ユーザー生成コンテンツ（UGC） | **あり（Yes）** | ユーザー名・bio・名言・プロフィール画像・名刺が他ユーザーに公開される。通報・ブロックは実装済み（導線は下の Review Notes 参照）。 |
| メッセージ・チャット | なし | アプリ内にユーザー間メッセージ機能はない。 |
| 制限なしの Web アクセス | なし | アプリ内に任意 URL を自由に閲覧するブラウザ機能はない。dアニメ取り込みの WebView は遷移先を dアニメストアと dアカウント認証（`*.smt.docomo.ne.jp`）の docomo ドメインに限定し、それ以外のドメインは外部ブラウザで開く（`apps/mobile/app/danime-import.native.tsx`・`apps/mobile/lib/danime/webviewAllowlist.ts`、#751）ため `unrestrictedWebAccess: false` とした。 |
| 暴力（カートゥーン/ファンタジー）・成熟/示唆的・性的コンテンツ・ホラー | INFREQUENT_OR_MILD | Annict 作品カタログに全ジャンルの作品が含まれ、キービジュアル（サムネイル）を表示するため。実コンテンツは作品名・ポスター画像のみ。 |
| その他（アルコール/薬物・ギャンブル・医療情報・下品なユーモア・リアルな暴力等） | NONE | 該当機能なし。 |
| 広告 | なし | 広告表示なし。 |
| ペアレンタルコントロール | なし | 搭載していない。 |

## Google Play 掲載情報

Play Console の「メインのストア掲載情報」に転記する文言。

### アプリ名（30 文字以内）

```
アニ名刺
```

### 簡単な説明（80 文字以内）

```
アニメの視聴記録がそのまま名刺に。QRコードで名刺を交換して、アニメ好きとつながろう。
```

### 詳細な説明（4000 文字以内）

```
アニメの視聴記録が、そのままあなたの名刺になる。
見たアニメを名刺にして、QRコードで一瞬で交換。
「アニ名刺」は、アニメ好きのための名刺作成・交換アプリです。

【自分だけのアニメ名刺を作成】
テンプレートを選んで、テキスト・画像・QRコード・作品画像のコラージュを自由に配置。視聴作品数バッジなど、あなたの「アニメ歴」がそのまま名刺になります。

【QRコードで名刺交換】
イベントやオフ会でQRを読み取るだけで名刺を交換。交換した相手はフレンドリストに登録されます。

【Annict連携で視聴記録を自動反映】
Annictと連携すれば、作品の検索や「見てる・見た・見たい」などの視聴ステータス管理ができ、その記録が名刺に反映されます。

【シーズンTier表を作って共有】
クールごとの全作品をS〜DのTierにドラッグで振り分け。完成したTier表は画像やURLでX（旧Twitter）などに共有できます。

【dアニメストアから視聴履歴をインポート】
dアニメストアで見た作品の履歴を取り込んで、Annict の視聴記録にまとめて反映できます。移行時の最初の登録の手間を省けます。

【その他の機能】
・お気に入り作品の登録・検索
・公開プロフィールページのURLを共有
・プロフィールに好きなセリフを登録

アニメが好きなら、名刺もアニメ色に。
今すぐ「アニ名刺」で、あなただけの一枚を作りましょう。
```

### グラフィックアセット

- アプリアイコン: 512×512 PNG
- フィーチャーグラフィック: 1024×500
- スクリーンショット: 2〜8 枚、短辺 320px 以上・長辺 3840px 以下、JPEG または 24bit PNG（16:9 または 9:16 推奨）

## スクリーンショット撮影手順

### 撮る画面（推奨・最初の3枚でベネフィットを伝える）

docs/archive/03 の ASO 方針に沿い、「得られる体験」を最初の 3 枚に置く。

1. 完成したアニメ名刺（プロフィールタブ or 名刺エディタ）…「一瞬で自分だけのアニメ名刺が完成」
2. QR 交換画面（マイQR / スキャン）…「QRで名刺交換」
3. Tier 表ボード or 共有画像 …「シーズンの感想をTier表に」
4. 以降任意: Annict 連携カード、視聴履歴・お気に入り一覧

### 必要なサイズ

- App Store: `app.json` の `ios.supportsTablet` は `false` なので iPhone 用のみでよい
  - iPhone 6.9 インチ: 1320×2868（または 6.5 インチ 1284×2778）
- Google Play: 上記のスクリーンショット要件を満たす任意サイズ

### Web 版で撮る（手軽）

Web 版は `apps/mobile` の web エクスポート（本番は https://animeishi.uomi.dev）。ローカルで撮る場合:

```bash
vp run @animeishi/mobile#dev
# Metro が起動したら `w` キーで Web を開く
```

1. Chrome で開き、DevTools → デバイスツールバー（Cmd+Shift+M）を有効化。
2. Dimensions を `Responsive` から `Edit` でカスタムデバイスを追加（例: 1290×2796, DPR 1 でほぼ 6.9" 相当）。DPR を上げれば必要解像度をそのまま確保できる。
3. DevTools のコマンドパレット（Cmd+Shift+P）→ `Capture screenshot` で撮影。
4. データは実アカウントでサインインして用意する（名刺・Tier 表・お気に入りを事前作成しておくと見栄えがよい）。

> iOS ネイティブの撮影では、Web 版の画面をそのまま流用せず、提出する Release ビルドの表示を使う。Wallet はネイティブで既定無効のため、Wallet が表示されたスクリーンショットは使わない。

### iOS シミュレータで撮る

```bash
cd apps/mobile
pnpm ios   # または eas build -p ios --profile development で dev client を作って起動
```

1. Simulator.app で対象デバイスを起動（6.9" なら iPhone Pro Max 系、13" なら iPad Pro 13 系）。
2. 撮りたい画面を表示して Cmd+S（`File > Save Screen`）。`~/Desktop` に PNG で保存される。
   - CLI なら `xcrun simctl io booted screenshot shot.png`。
3. ステータスバーは実際の時刻・電波が出る。必要なら `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100 --cellularBars 4` で整える。

### Android エミュレータで撮る（Play 用）

```bash
cd apps/mobile
pnpm android
```

エミュレータのカメラボタン、または `adb exec-out screencap -p > shot.png`。

## EAS Metadata の運用

```bash
cd apps/mobile
eas metadata:pull   # App Store Connect の現行値を store.config.json に取り込む
eas metadata:push   # store.config.json を App Store Connect に反映
```

- 新規アプリの場合、先に `eas submit -p ios` でバイナリを 1 回提出してからでないと `metadata:push` は失敗する。

## App Review Notes (English draft)

App Review Information の notes 欄に貼る英語の下書き（上限 4,000 バイト）。画面ラベルは英語 UI での表記に、日本語のまま残っている部分だけ併記する（検証時点: タブ名・操作ボタンは英語化済み。「みつける」セグメントとその中の「作品リスト / Tier 表 / 名刺」チップ、QR セグメント名は日本語のまま）。

```text
Hello App Review,

1. PURPOSE AND AUDIENCE
Animeishi is a card-making and card-exchange app for anime fans. Users build a personal card from their anime watch records, exchange it with other fans by scanning a QR code, and create and share season tier lists and work lists.

2. DEMO ACCOUNT AND SIGN-IN
Permanent credentials are provided in the App Review Information sign-in fields. Enter the provided email address and password on the sign-in screen and tap "Sign in". The demo account signs in directly — no email verification code is sent or required. It is pre-populated with a public profile, favorite titles, ratings, work lists (one public, one private), a public season tier list, and a friend. The card layout is stored on-device; watch-history screens fill in only after connecting an Annict account (see section 4).

Most of the app is localized in English. A few in-screen segment labels still appear only in Japanese; those labels are quoted in Japanese below where they appear.

3. QR CARD EXCHANGE (SECOND DEVICE NORMALLY REQUIRED)
Card exchange happens between two signed-in users: one shows a QR code and the other scans it. To review the flow with a single device:
1. Open the "QR & Friends" (QR・フレンド) tab.
2. The "QR" segment shows the demo account's own QR code ("My QR code") and a "Scan" button, which asks for camera permission.
3. To see the post-exchange state, open "Friends" (フレンド) — a seeded friend opens the public profile reached after an exchange. With a second device, create another account and scan the QR code to see the live exchange.

4. OPTIONAL INTEGRATIONS
- Annict (watch-record service): optional. To connect, open "Profile" (プロフ) → the Annict card → "Connect to Annict" (Annict と連携する) and complete OAuth on annict.com. Only watch-record features (work search, statuses, history) require it.
- d Anime Store history import: open "Profile" → "dアニメストアから視聴履歴をインポート". A browser view limited to the official d Anime Store site and docomo sign-in domains opens (other links go to the external browser). The user signs in on the official site and only their own watch history is read in the view. d Account credentials and cookies stay in the view and are never sent to our servers — extracted titles and watch statuses go to our API to match and record Annict works. A screen recording is attached (review requires a d Account).

5. USER CONTENT AND MODERATION (GUIDELINE 1.2)
User-generated content includes profile text and images, cards, tier lists, and work lists shown publicly.
- Report a user: open a user's profile (for example from the "Discover" (ひろば) tab → "みつける" segment → "名刺" feed) and tap "Report this user" (このユーザーを通報).
- Block a user: on the same profile, tap "Block this user" (このユーザーをブロック). Blocked users are managed under "Profile" → "Privacy & Safety" (プライバシーと安全) → "Blocked users" (ブロック中のユーザー).
- Report public content: in the same "みつける" segment, choose the "作品リスト", "Tier 表", or "名刺" feed and tap "Report" (通報) on an item.
New reports notify the operator, who reviews details and resolves or dismisses each report per the documented moderation procedure. There is no in-app direct messaging between users.

6. ACCOUNT DELETION
The account can be deleted in-app without contacting support: open "Profile" → "Delete account" (アカウントを削除) below "Sign out" (サインアウト) and follow the steps.

7. AI ANALYSIS
Runs only on tapping "Analyze", "Analyze again" or "Get recommendations", on Cloudflare Workers AI (our host; no other AI vendor). Sends titles, statuses, ratings, genres and stats; no account info. Not used to train AI.

8. OTHER
- The app is free and has no in-app purchases or subscriptions.
- Behavior is the same in all regions. The UI is available in Japanese and English.
```

補足（提出者向け、notes には含めない）:

- デモアカウントの認証情報は App Store Connect の「App Review に関する情報 → サインイン情報」欄に入れる（メールアドレス + パスワード）。`pnpm task review-account:seed` で本番に作るゲストアカウントは、サインイン画面にそのままメール・パスワードを入れるだけで Device Trust のメールコードなしにログインできる（`POST /auth/demo-sign-in` の ticket 経由。`apps/mobile/lib/reviewAccount.ts`）。
- デモアカウントに入るデータ: プロフィール（公開）・お気に入り 5 件・評価 5 件・作品リスト 2 件（公開 1 / 非公開 1）・公開 Tier 表 1 件・フレンド 1 名（`apps/api/scripts/review-account.mjs`）。名刺は端末内保存、視聴履歴は Annict 連携前提なのでシードしない。
- モデレーション手順: 通報は Discord 通知（件数のみ）→ `pnpm task reports:list` で内容確認 → `pnpm task reports:resolve|dismiss|reopen` で対応（`docs/runbook/production-tasks.md`「通報モデレーション」）。
- dアニメ取り込みの画面録画（#751）: 審査担当は dアカウントを持たないため、実機の Release ビルドで「プロフィール → データの取り込み → WebView で dアカウントログイン → 読み取り開始 → レビュー画面まで」の一連の操作を画面収録し、App Store Connect の「App Review に関する情報」の添付ファイルとして提出に含める。

## ガイドライン 4.8 のコード確認

提出候補である EAS `preview` と `production` はどちらも `pk_live_` Clerk publishable key を使う（`apps/mobile/eas.json`）。Google ログインは明示 override がない場合 `pk_test_` のときだけ有効で、両 EAS profile に `EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN` の true override はない（`apps/mobile/lib/featureFlags/googleSignIn.ts`）。したがって提出候補では表示されない。

ネイティブのパスキーは `apps/mobile/lib/featureFlags/passkey.native.ts` が常に `false` を返し、Wallet も EAS env で有効化されていない。認証画面の Google ボタンおよびパスキー表示はそれぞれこのフラグに従う。確認根拠: `apps/mobile/lib/featureFlags/index.ts`、`apps/mobile/app/(auth)/sign-in.tsx`、`apps/mobile/app/(auth)/sign-up.tsx`、`apps/mobile/components/profile/PasskeySection.tsx`。このため、production / preview にサードパーティログインが表示される経路は見つからなかった。なお dアニメ取り込みは #751 でネイティブでも既定有効だが、dアカウントのログインはアプリの認証ではなく取り込み画面の WebView 内で docomo 側が完結する処理のため、4.8（サードパーティログイン手段）には該当しない。

## App Privacy 回答案（App Store Connect）

以下は iOS アプリの実装に基づく申告案。App Store Connect の質問形式に合わせて整理してある。目的はアプリ機能提供（App Functionality）と品質改善（Analytics）のみで、広告・第三者トラッキングには使用しない。Apple の定義は改訂され得るため、最終申告は提出時の質問文に照らして確認する。

### トラッキング（Data Used to Track You）

**なし。** 広告 SDK・広告目的のデータ共有・IDFA 取得はなく、App Tracking Transparency の表示も不要（依存パッケージの計測系は `@sentry/react-native`（エラー監視）と `posthog-react-native`（プロダクト計測。自社の分析にだけ使い、他社データとの結合・広告・データブローカーへの提供はしない）のみ）。

### ユーザーに紐づくデータ（Data Linked to the User）

| App Store Connect の項目 | 実装の根拠 | 目的 |
| --- | --- | --- |
| Contact Info → Email Address | サインアップ時に入力。Clerk が管理（`app/(auth)/sign-up.tsx`） | App Functionality |
| Contact Info → Name | ユーザー名（サインアップ・プロフィールで入力） | App Functionality |
| Identifiers → User ID | Clerk のアカウント ID。PostHog には生 ID でなくソルト付き SHA-256 先頭 16 文字の user key を distinct_id として送る（`lib/events.ts`、API は `src/lib/posthog.ts`）。user key は同一利用者のイベントを結び付ける ID のため Analytics 目的でも申告する | App Functionality / Analytics |
| User Content → Photos or Videos | 任意のプロフィール画像を R2 に保存（`apps/api` の `AVATARS` バケット） | App Functionality |
| User Content → Other User Content | プロフィール（自己紹介・好きなセリフ・ジャンル・公開設定）、お気に入り・評価・視聴ステータス・フレンド関係・Tier 表・作品リスト、通報・不具合報告フォームの投稿内容。dアニメ取り込みでは抽出した作品タイトル・作品 ID・視聴ステータスを Annict 作品との照合・記録のためサーバーへ送信する（認証情報・Cookie は WebView 内に留まり送信しない）。名刺は端末内（AsyncStorage）保存で、共有時は利用者が選んだ共有先へ渡す | App Functionality |
| Usage Data → Product Interaction | 起動・画面・主要操作・オンボーディング完了等のイベントを PostHog に送信（platform・アプリ版・screen・イベント属性、SDK が付ける端末種別・OS 版・言語、distinct_id に仮名化 user key。`lib/events.ts`、`lib/annict/funnel.ts`）。サインアップ完了・名刺交換の成立は API が PostHog へ送る（`apps/api/src/lib/posthog.ts`）。自動収集（autocapture）・セッションリプレイ・アンケートは無効。EAS Observe にもルート名・画面遷移タイミングが送られるが、そちらは紐づけなし（下表）。仮名化キーで紐づく PostHog 側があるため全体として「紐づく」で申告する | Analytics |

### ユーザーに紐づかないデータ（Data Not Linked to the User）

| App Store Connect の項目 | 実装の根拠 | 目的 |
| --- | --- | --- |
| Diagnostics → Crash Data | クラッシュ・エラーを Sentry に送信（`sendDefaultPii: false`、`tracesSampleRate: 0`、セッションリプレイ・プロファイリング無効、リクエストヘッダー整形・本文除外。`lib/observability.ts`）。加えて EAS Observe は `errorHandlingEnabled: false`（JS エラー収集オフ）でもネイティブクラッシュを送信する（`lib/observe.ts`） | App Functionality |
| Diagnostics → Performance Data | EAS Observe が起動・レンダリング・操作可能（TTR/TTI）・アップデートダウンロード時間を計測（`lib/observe.ts`。ObserveRoot + `markInteractive`） | App Functionality |
| Diagnostics → Other Diagnostic Data | EAS Observe が全レコードに付けるデバイスモデル・OS 版・アプリ版・言語タグ・Expo Update チャネル等と、起動時のバッテリー・熱・ネットワーク状態 | App Functionality |
| Identifiers → Device ID | EAS Observe / EAS Update が使う Expo Services client ID（インストールごとのランダム ID。アカウント・ハードウェア ID とは無関係で、Expo 側でも他データと突き合わせないため紐づけなし） | App Functionality / Analytics |
| Usage Data → Product Interaction | EAS Observe の expo-router 連携がルート名と画面遷移タイミングを送信（`lib/observe.ts`）。`filteredParams` で `code` / `state` / `uid` は除外 | Analytics |
| Location → Coarse Location | EAS Observe が送信時の IP アドレスから国を導出して保存（Expo の申告ガイドでは常時収集と記載。SDK のマニフェストには含まれないため ASC の回答で追加が必要） | Analytics |

### 申告外・補足

- EAS Observe（`expo-observe`）は Expo のサービスプロバイダとしてデータを処理し、90 日で削除される。Expo は広告利用・データブローカーへの提供を行わない（[Expo の申告ガイド](https://docs.expo.dev/eas/observe/reference/store-privacy-declarations/)）。本アプリは `errorHandlingEnabled: false` で JS エラー収集を切り、ネットワークトレース・ユーザー定義イベントも使っていないため、ルート名・タイミング系とネイティブクラッシュのみが送信対象。ユーザー ID を載せる送信はない。
- PostHog（`posthog-react-native`）は `disableGeoip: true` で IP から所在地を引かせず、プロジェクト設定でも「Discard client IP data」を ON にする（`docs/runbook/posthog.md`）。このため PostHog 由来の Location は申告しない。プロジェクトキー未設定のビルドでは SDK を読み込まず何も送らない。
- Annict アクセストークンは iOS では SecureStore にのみ保持し、サーバーには保存しない。Annict API への送信は連携した利用者の操作時のみ（`lib/annict/storage.native.ts`）。
- AniList・Jikan（MyAnimeList）には作品 ID のみをサーバー経由で送信し、個人情報は含まない（`privacy.tsx` 第4条）。
- Cloudflare Workers のアクセスログ（リクエスト IP 等）はホスティング基盤側の処理で、ポリシーには記載済み。ASC の質問で第三者による収集に当たると判断された場合は回答を調整する。
- dアニメ取り込みの作品タイトル送信は #751 で iOS でも有効になったため、User Content → Other User Content（App Functionality）の申告対象に含めた。Apple Wallet 追加は iOS ではフラグ無効のため引き続き申告対象外。
- AI 視聴傾向分析・おすすめ（#752）が Workers AI に送る項目（作品タイトル・視聴ステータス・作品評価・選択ジャンルと、そこからの集計値）は、上表の User Content → Other User Content（評価・視聴ステータス・ジャンル）に含まれ、新しい申告項目は要らない。送信先は Cloudflare（ホスティングと同じサービスプロバイダ）で、Cloudflare は Workers AI の入出力をモデル学習に使わず、推論後は原則として保持しない（[Workers AI Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)）。生成結果は利用者ごとに最新 1 件を D1 に保存する（`apps/api/src/features/analysis/`。24h キャッシュは再利用の判定で、削除期限ではない）。

### プライバシーポリシーとの照合結果（`apps/mobile/app/privacy.tsx`）

上表の内容はポリシー第2条・第4条に記載があり一致する。#590 で以下のずれを解消済み:

- 第2条にユーザー通報（通報対象・理由）の保存を追記
- 第4条に EAS Observe への計測データ送信（起動・画面遷移タイミング・ネイティブクラッシュ・端末情報・client ID・IP 由来の国）を追記
- `app.json` の `ios.privacyManifests.NSPrivacyCollectedDataTypes` を上表と同じデータ種別に更新（expo-observe の SDK 同梱マニフェストは Crash/Performance/OtherDiagnostic/DeviceID/ProductInteraction のみで Coarse Location が無いため、アプリ側で上表の全項目を宣言して Xcode プライバシーレポートと回答を一致させている）

## 掲載文言の機能照合（ガイドライン 2.3）

`store.config.json` の説明文（ja / en-US）・キーワードと上のスクリーンショット計画を、提出ビルドで実際に使える機能と照合した結果:

- 説明文にある機能はすべてネイティブで提供される: 名刺作成・QR 交換・Annict 連携・Tier 表・dアニメ取り込み（#751 でネイティブ有効化）・お気に入り・公開プロフィール URL・好きなセリフ。
- **ネイティブにない機能は含まれていない**: Apple Wallet 追加（`featureFlags.wallet` は `EXPO_PUBLIC_FEATURE_WALLET` 未設定で無効、pkpass 署名未実装 #103）・総選挙・イベント・特集記事（`featureFlags.elections` / `events` / `articles` は `EXPO_PUBLIC_FEATURE_ELECTIONS` / `_EVENTS` / `_ARTICLES` 未設定で無効 #750）は説明文にもスクリーンショット計画にも出ていない。説明文の「イベントやオフ会で」は現地での QR 交換の場面を指し、アプリ内のイベント機能ではない。
- App Store 用スクリーンショットは提出する Release ビルドで撮ること（下の撮影手順の注意書きどおり）。Web 版で撮るとネイティブにない機能が写り込み得るため、App Store には使わない。

## TODO（ストア提出前に要解決・オーナー作業）

- リリース時に MAL へ通知する（MAL API License Agreement 4(b)。#245）
- App Review 用連絡先（氏名・メール・電話番号）を決め、`store.config.json` の `apple.review` と App Store Connect に登録する
- デモアカウントの認証情報を App Store Connect のサインイン情報に入力する（アカウント本体は `pnpm task review-account:seed` で作成済みのはず。パスワードを変えたら seed を再実行）
- dアニメ取り込みの操作画面録画を撮影し、App Review Information の添付ファイルとして提出に含める（審査担当は dアカウントを持たないため。#751。手順は上の「補足」参照）
- 著作権表記の確定: `store.config.json` の `apple.copyright` は現在 `2026 アニ名刺製作委員会`。issue #512 の方針（`2026 Kohei Uozumi` に揃えるか）を確定して更新する
- Apple Wallet 追加（#81 / #103）が完成したら説明文への追記を検討（現状 pkpass 署名未設定のため未提供。審査ガイドライン 2.3 抵触回避のため掲載文言からは除外済み）
