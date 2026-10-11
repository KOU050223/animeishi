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
| サポート URL | https://animeishi.uomi.dev/support（`apps/mobile/app/support.tsx`。未ログイン閲覧可。連絡先メールは `{{CONTACT_EMAIL}}` プレースホルダで、#133 で確定次第差し替え） |
| カテゴリ | App Store: エンターテイメント（主）/ ソーシャルネットワーキング（副）。Play: エンターテイメント |

## 年齢レーティング（コンテンツの質問への回答）

App Store の年齢レーティング質問票は `store.config.json` の `advisory` に記述済み。Play 側の IARC アンケートも同じ方針で回答する。

| 質問 | 回答 | 根拠 |
| --- | --- | --- |
| ユーザー生成コンテンツ（UGC） | **あり（Yes）** | ユーザー名・bio・名言・プロフィール画像・名刺が他ユーザーに公開される。通報・ブロック機能は [#135](https://github.com/KOU050223/animeishi/issues/135) で実装中（審査提出までにマージされていることが望ましい）。 |
| メッセージ・チャット | なし | アプリ内にユーザー間メッセージ機能はない。 |
| 制限なしの Web アクセス | なし | dアニメ取り込みの WebView は `animestore.docomo.ne.jp` のページ表示が前提で、任意 URL を自由に閲覧するブラウザ機能ではないため `unrestrictedWebAccess: false` とした（判断余地あり・要確認）。 |
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

【dアニメストアの視聴履歴をまとめて取り込み】
dアニメストアの視聴履歴・視聴済み作品を一括で取り込み、Annictの視聴ステータスに反映。これまでの視聴歴が一瞬で名刺に載ります。

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
4. 以降任意: Annict 連携カード、dアニメ取り込み、視聴履歴・お気に入り一覧

### 必要なサイズ

- App Store（`supportsTablet: true` のため iPad も必須）:
  - iPhone 6.9 インチ: 1320×2868（または 6.5 インチ 1284×2778）
  - iPad 13 インチ: 2064×2752
- Google Play: 上記のスクリーンショット要件を満たす任意サイズ

### Web 版で撮る（手軽）

Web 版は `apps/mobile` の web エクスポート（本番は https://animeishi.uomi.dev）。ローカルで撮る場合:

```bash
nix develop --command task dev:mobile
# Metro が起動したら `w` キーで Web を開く
```

1. Chrome で開き、DevTools → デバイスツールバー（Cmd+Shift+M）を有効化。
2. Dimensions を `Responsive` から `Edit` でカスタムデバイスを追加（例: 1290×2796, DPR 1 でほぼ 6.9" 相当）。DPR を上げれば必要解像度をそのまま確保できる。
3. DevTools のコマンドパレット（Cmd+Shift+P）→ `Capture screenshot` で撮影。
4. データは実アカウントでサインインして用意する（名刺・Tier 表・お気に入りを事前作成しておくと見栄えがよい）。

### iOS シミュレータで撮る

```bash
cd apps/mobile
nix develop --command pnpm ios   # または eas build -p ios --profile development で dev client を作って起動
```

1. Simulator.app で対象デバイスを起動（6.9" なら iPhone Pro Max 系、13" なら iPad Pro 13 系）。
2. 撮りたい画面を表示して Cmd+S（`File > Save Screen`）。`~/Desktop` に PNG で保存される。
   - CLI なら `xcrun simctl io booted screenshot shot.png`。
3. ステータスバーは実際の時刻・電波が出る。必要なら `xcrun simctl status_bar booted override --time 9:41 --batteryLevel 100 --cellularBars 4` で整える。

### Android エミュレータで撮る（Play 用）

```bash
cd apps/mobile
nix develop --command pnpm android
```

エミュレータのカメラボタン、または `adb exec-out screencap -p > shot.png`。

## EAS Metadata の運用

```bash
cd apps/mobile
eas metadata:pull   # App Store Connect の現行値を store.config.json に取り込む
eas metadata:push   # store.config.json を App Store Connect に反映
```

- 新規アプリの場合、先に `eas submit -p ios` でバイナリを 1 回提出してからでないと `metadata:push` は失敗する。

## TODO（ストア提出前に要解決）

- 連絡先メールアドレスの確定（#133。/support・/privacy・/terms の `{{CONTACT_EMAIL}}` / `{{OPERATOR_NAME}}` プレースホルダを差し替え）
- App Review 用連絡先（氏名・メール・電話番号）と審査用デモアカウントの準備（`store.config.json` の `review` に追記）
- 著作権表記 `2026 Kohei Uozumi` が法人/個人名として適切か確認
- #135（通報・ブロック）未マージのまま審査に出す場合、UGC アプリの moderation 要件でリジェクトされる可能性を確認
- Apple Wallet 追加（#81 / #103）が完成したら説明文への追記を検討（現状 pkpass 署名未設定のため未提供。審査ガイドライン 2.3 抵触回避のため掲載文言からは除外済み）
