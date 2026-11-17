# ストア掲載情報

アプリストア（App Store / Google Play）の掲載情報とスクリーンショット撮影手順のまとめ。

- **App Store**: [`apps/mobile/store.config.json`](../apps/mobile/store.config.json) でコード管理（EAS Metadata）。`eas metadata:push` で App Store Connect に反映する。
- **Google Play**: EAS Metadata は現時点で App Store のみ対応のため、この文書の文言を Play Console に手動で転記する。
- 文言の方針は [docs/03](03_next-actions-plan.md) の ASO 方針（機能ではなくベネフィットを前面に出す）に従う。

## 共通

| 項目 | 値 |
| --- | --- |
| アプリ名 | アニ名刺（英語圏: Animeishi） |
| プライバシーポリシー URL | https://animeishi.uomi.dev/privacy |
| 利用規約 URL | https://animeishi.uomi.dev/terms（App Store は標準 EULA、Play Console の各所やフッター参照用） |
| サポート URL | https://animeishi.uomi.dev/support（`apps/mobile/app/support.tsx`。未ログイン閲覧可。連絡先メールは `support@uomi.dev`（`apps/mobile/lib/legal/operator.ts`）） |
| カテゴリ | App Store: エンターテイメント（主）/ ソーシャルネットワーキング（副）。Play: エンターテイメント |

> dアニメストアからの視聴履歴取り込みは v1.0 では **Web 版限定**（#158。審査 5.2.2 リスク回避のためネイティブで無効化）。
> ネイティブに無い機能を掲載すると 2.3（正確なメタデータ）違反になるため、説明文・スクリーンショットには含めない。
> Web 版の機能説明としては [docs/07](07_danime-import-design.md) を参照。

## 年齢レーティング（コンテンツの質問への回答）

App Store の年齢レーティング質問票は `store.config.json` の `advisory` に記述済み。Play 側の IARC アンケートも同じ方針で回答する。

| 質問 | 回答 | 根拠 |
| --- | --- | --- |
| ユーザー生成コンテンツ（UGC） | **あり（Yes）** | ユーザー名・bio・名言・プロフィール画像・名刺が他ユーザーに公開される。通報・ブロック機能は [#135](https://github.com/KOU050223/animeishi/issues/135) で実装中（審査提出までにマージされていることが望ましい）。 |
| メッセージ・チャット | なし | アプリ内にユーザー間メッセージ機能はない。 |
| 制限なしの Web アクセス | なし | dアニメ取り込みは v1.0 では Web 版限定でネイティブ側の WebView は無効化済み（#158）。アプリ内に任意 URL を自由に閲覧するブラウザ機能はないため `unrestrictedWebAccess: false` とした。 |
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

docs/03 の ASO 方針に沿い、「得られる体験」を最初の 3 枚に置く。

1. 完成したアニメ名刺（プロフィールタブ or 名刺エディタ）…「一瞬で自分だけのアニメ名刺が完成」
2. QR 交換画面（マイQR / スキャン）…「QRで名刺交換」
3. Tier 表ボード or 共有画像 …「シーズンの感想をTier表に」
4. 以降任意: Annict 連携カード、視聴履歴・お気に入り一覧

### 必要なサイズ

- App Store（`supportsTablet: true` のため iPad も必須）:
  - iPhone 6.9 インチ: 1320×2868（または 6.5 インチ 1284×2778）
  - iPad 13 インチ: 2064×2752
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

> iOS ネイティブの撮影では、Web 版の画面をそのまま流用せず、提出する Release ビルドの表示を使う。Wallet はネイティブで既定無効、d アニメ取り込みもネイティブで無効のため、これらが表示されたスクリーンショットは使わない。

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

> Sign-in details for the demo account are provided separately in App Store Connect under App Review Information. The account is pre-populated with a public profile, favorite titles, ratings, a public and a private work list, a tier list, and an existing friend. No password or other secret is included in these notes.
>
> QR card exchange normally requires a second device. To review the resulting friend experience on one device, sign in with the demo account, open the tab labeled “QR・フレンド,” and select “フレンド.” The seeded friend is already listed there. Tab and section labels are currently shown in Japanese even when the app language is English.
>
> Connecting an Annict account is optional. To connect it, open the tab labeled “プロフ” and use the “Annict integration” card and its “Connect Annict” button. The app can be explored without connecting Annict; Annict-dependent watch-record features are available only after the user chooses to connect. d Anime Store history import is not available in the iOS app.
>
> To report a user, open their profile and select “このユーザーを通報”; to block them, select “このユーザーをブロック.” Public content can also be reported from the “ひろば” tab: select “みつける,” choose “作品リスト,” “Tier 表,” or “名刺,” then select “通報” on an item. These tab and action labels are currently shown in Japanese in the app. Blocked users are listed under “プロフ” → “プライバシーと安全” → “ブロック中のユーザー.” Reports are reviewed by the operator. New reports trigger an operations notification; the operator checks report details with `pnpm task reports:list` and records moderation decisions following the production runbook. There is no in-app direct messaging.
>
> To delete the demo account, open the “プロフ” tab, scroll below “サインアウト,” select “アカウントを削除,” and follow the confirmation steps. This button is currently displayed in Japanese (the English translation resource contains “Delete account”). Account deletion is available in the app without contacting support.

## ガイドライン 4.8 のコード確認

提出候補である EAS `preview` と `production` はどちらも `pk_live_` Clerk publishable key を使う（`apps/mobile/eas.json`）。Google ログインは明示 override がない場合 `pk_test_` のときだけ有効で、両 EAS profile に `EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN` の true override はない（`apps/mobile/lib/featureFlags/googleSignIn.ts`）。したがって提出候補では表示されない。

ネイティブのパスキーは `apps/mobile/lib/featureFlags/passkey.native.ts` が常に `false` を返し、Wallet と d アニメ取り込みも EAS env で有効化されていない。認証画面の Google ボタンおよびパスキー表示はそれぞれこのフラグに従う。確認根拠: `apps/mobile/lib/featureFlags/index.ts`、`apps/mobile/app/(auth)/sign-in.tsx`、`apps/mobile/app/(auth)/sign-up.tsx`、`apps/mobile/components/profile/PasskeySection.tsx`。このため、production / preview にサードパーティログインが表示される経路は見つからなかった。

## App Privacy 回答案（App Store Connect）

以下は iOS アプリの実装に基づく申告案。目的はアプリ機能と品質改善で、広告・第三者トラッキングには使用しない。Apple の定義に照らした最終申告は提出時に確認する。

| Apple のデータ種別 | 実際に収集・送信するデータ | ユーザーに紐づくか | トラッキング目的か |
| --- | --- | --- | --- |
| Contact Info | Clerk が管理するメールアドレス、ユーザー名 | はい（アカウント） | いいえ |
| User Content | プロフィール（自己紹介・好きなセリフ・ジャンル・公開設定）、任意のプロフィール画像、視聴履歴・お気に入り・評価・フレンド関係・Tier 表・作品リスト、ユーザー通報や問い合わせ内容。名刺画像は端末内に保存し、画像共有時にユーザーが選んだ共有先へ渡す | はい | いいえ |
| Identifiers | Clerk のアカウント識別子はサービス内で利用。Sentry UI イベントには生 ID ではなくソルト付き SHA-256 の短縮 user key を付与する。アプリ・端末・リクエストの技術識別情報もサービス運用に伴い送信される | はい（UI イベントは仮名化キーで関連付け） | いいえ |
| Usage Data | 画面・主要操作イベント（例: 視聴状態変更、分析生成、Annict 接続ファネル）。Sentry Logs に platform、アプリ版、screen、イベント属性と仮名化 user key を送る | はい（仮名化キー） | いいえ |
| Diagnostics | クラッシュ・エラー診断情報を Sentry に送信。トレース/セッションリプレイ/プロファイリングは無効。既定 PII は無効化 | いいえ（設定上の方針。エラー本文等に利用者入力が含まれないか運用時の留意は残る） | いいえ |
| Other Data | Annict 連携トークンは iOS では SecureStore に保存し、Annict API への連携時に送る。作品検索・記録要求も Annict に送信する。サーバーのアクセスログは Cloudflare が処理する | はい（連携利用者・リクエストに紐づく） | いいえ |

ポリシー照合（`apps/mobile/app/privacy.tsx`）: メール/ユーザー名、プロフィール、視聴情報、画像、問い合わせ、Sentry、Annict の説明は概ね実装と一致する。iOS では Annict token は SecureStore に保存されるが、Annict 連携と連携先への送信自体は任意で利用者の操作による。d アニメ作品タイトルの送信は Web の任意機能であり iOS では利用不可。Wallet の記述も Wallet 機能が有効な場合に限る（現行ネイティブビルドでは無効）。ポリシーには「Sentry にユーザー情報や IP アドレス等を送らない」とある一方、UI 計測はハッシュ済み利用者キーを付け、Cloudflare のアクセスログはリクエスト IP 等を処理し得るため、表現には差がある。ポリシー変更はこの作業では行っていない。

## TODO（ストア提出前に要解決）

- リリース時に MAL へ通知する（MAL API License Agreement 4(b)。#245）
- App Review 用連絡先（氏名・メール・電話番号）と審査用デモアカウントの準備（`store.config.json` の `review` に追記）
- #135（通報・ブロック）未マージのまま審査に出す場合、UGC アプリの moderation 要件でリジェクトされる可能性を確認
- Apple Wallet 追加（#81 / #103）が完成したら説明文への追記を検討（現状 pkpass 署名未設定のため未提供。審査ガイドライン 2.3 抵触回避のため掲載文言からは除外済み）
