# 10. Expo SDK アップグレード方針（SDK 54 → 58）

調査日: 2026-10-28。一次情報は Expo changelog（https://expo.dev/changelog）。
詳しい変更点は各 SDK のリリースノートを読むこと。この文書には
「なぜその方針か」と「前提が変わったときどうするか」だけを残す。

## 現在地

| 項目 | 移行前 | 移行後（本ブランチ） |
|------|------|------|
| Expo SDK | 54（expo ~54.0.37） | 58（expo ^58.0.0 → 58.0.20） |
| React Native | 0.81.5 | 0.88.0 |
| React | 19.1.0 | 19.3.0 |
| expo-router | ~6.0.24 | ~58.0.27 |

SDK のサポート期間は約1年。SDK 54（2025-09 リリース）は 2026 年秋で
クリティカル修正が打ち止めになる時期であり、今がちょうど境目。

## Expo 側の流れ（調査で分かった構造変化）

- **リリース cadence が変わった**: RN が「1つおきに破壊的変更なし」で
  出すようになり、Expo もそれに追随。SDK 57 のような「RN を上げるだけの
  無破壊リリース」が挟まる。以降は SDK 番号差 = 移行コスト差ではない
- **expo-* パッケージの版は SDK 番号に統一**（SDK 55〜）: SDK 58 なら
  `expo-camera ^58.0.0` のように読み替える
- **Hermes V1**: SDK 55 でオプトイン、SDK 56 でデフォルト化。
  ただし SDK 56〜57.0.8 に reanimated/worklets 環境でのメモリ爆増
  リグレッションがあり `expo@57.0.17`（RN 0.86.3）で修正済み
- **旧 Architecture は SDK 55 で完全削除**（本プロジェクトは New Arch 済み）
- **Expo UI（`@expo/ui`）**: SDK 56 で SwiftUI/Compose API が stable。
  universal コンポーネント（iOS/Android/Web 共通）は SDK 56+ が前提
- **EAS Update の Hermes バイトコード差分配信**: SDK 56 でデフォルト化。
  更新ダウンロードが約6割縮小。本プロジェクトは EAS Update 利用中なので恩恵あり
- **Expo Go は実質サブ経路に**: App Store 審査遅延とログイン必須化で、
  dev client がデフォルトの開発経路。本プロジェクトは既に dev client
- **エージェント向けツール**: Expo MCP（Free plan 可）、`@expo/agent-cli`、
  公式 `expo/skills` リポジトリ（このリポジトリにも upgrading-expo 等の
  スキルが入っている）

## 方針: SDK 58 へ直行

**採る案**: 54 → 58 へ一気に上げる。

**採らなかった案**:

- **SDK 56 止まり**: Hermes V1 + reanimated/worklets のメモリ
  リグレッションを抱えたままになる。このアプリは reanimated 4.1.7 +
  worklets 0.5.1 を使っているので踏み台にできない
- **SDK 57 止まり**: 無破壊リリースではあるが、すぐ上に 58 があり
  サポート期間も短い。2回分の移行コストを払う意味がない
- **段階的に 54→55→56→…**: 4回分の prebuild・動作確認・EAS build を
  通すのは手数が多い。各 SDK の破壊的変更は限定的なので、まとめて
  上げて差分を潰す方が早いと判断

手順は Expo 公式と同じ: `npx expo install expo@^58.0.0 --fix` →
`npx expo-doctor@latest` → SDK 57→58 ルーター移行ガイド
（https://docs.expo.dev/router/migrate/sdk-57-to-58/）の確認。
作業時はリポジトリの `upgrading-expo` スキルを使う。

## アップグレード時の確認事項（このコードベース固有）— 実施結果

- [x] `app.json` の `newArchEnabled` を削除 → 済（SDK 55 で廃止）
- [x] `web.output: "single"` → 明示指定のまま維持。Metro の web バンドル
      が正常に生成されることを確認
- [x] Web での safe area: Expo Router 側の供給は CSS `env(safe-area-inset-*)`
      推奨に移行したが、アプリ側は `app/_layout.tsx` の `SafeAreaProvider`
      （react-native-safe-area-context 自身の Web 実装）を経由しているため
      各画面の `SafeAreaView` / `useSafeAreaInsets` は従来どおり動く
- [x] `eas update` の `--environment` → 必須化済みのため
      `docs/04_deployment.md` の手順を `--environment production` に更新
- [x] Hermes V1 デフォルト化に伴う動作確認 → Release ビルドした実機相当の
      アプリが iOS 18.5 シミュレーターで起動し、E2E の認証フローを通過
- [x] サードパーティの SDK 58 対応:
      - Sentry: 7.2.0 固定（Sentry RN 8 待ちだった SDK 制約）を解除し ~8.28.0 へ
      - Clerk: `@clerk/clerk-expo` 最新で動作。`@clerk/expo` への
        パッケージ移行は別タスク（deprecation warning が出る）
      - NativeWind: v4（^4.2.7）のまま動作。v5 移行はスコープ外（#315）
      - reanimated 4.7.1 / worklets 0.13.0: Hermes V1 下で jest・E2E 両方動作
- [x] `vp run @animeishi/mobile#e2e:ios` → PASS（iOS 18.5 シミュレーター、
      auth-lifecycle 2m22s。詳細は PR 記載）

## 移行で詰まった点（次回の SDK 上げのために）

- **node_modules の残滓**: 旧版からの再インストールで
  `node_modules/react-native/node_modules/@react-native/codegen` に
  旧 codegen（0.81.5）が残ると、pod install の codegen が
  「method blur must be of type React.ElementRef<>」で落ちる。
  新しい codegen（0.88.0）は `ComponentRef` も受理するので、
  残滓を消せば解決する。SDK 上げ後に pod install が謎に失敗したら
  `node_modules` 内の古い入れ子パッケージを疑う
- **テストの API 変更**: RNTL 14 で `render` / `renderHook` / `fireEvent`
  系が非同期化。`@testing-library/jest-native`（extend-expect）は廃止。
  Jest 30 + jsdom では `window` が非 configurable になったため、
  jsdom 環境で RN の jest-preset setup を使うテストには
  `apps/mobile/jest.jsdom-env.cjs`（グローバル複写環境）が必要
- **RN 0.88 の厳格型**: `View` / `ScrollView` 等のクラス型は
  `ViewInstance` / `ScrollViewInstance` 等の `*Instance` 型に改名。
  `StyleSheet.absoluteFillObject` は `absoluteFill` に統一された

## 追従して検討したいこと（SDK 58 化とは別タスク）

### NativeTabs 化

現在は React Navigation の JS 製 `Tabs`。`NativeTabs`（OS 純正タブバー）
にすると iOS 26+ の Liquid Glass・スクロール連動の縮小・safe area 自動処理・
iPhone Duo の縦レール配置が乗る。**ただし Android は最大5タブ**で、
このアプリは7タブ（ホーム/アニメ/QR/履歴/推し/フレンド/プロフ）あるため
そのまま移行不可。タブ構成の見直しか Android だけ JS Tabs 残留かの
設計判断が先に要る。Web は `_layout.web.tsx` 分離で現行維持。

### `@expo/ui` 試用

SwiftUI/Compose の実物を React から描く。universal 層は SDK 56+ 前提。
NativeWind ベースの独自デザインなので全面採用ではなく、設定フォーム・
ピッカー・ボトムシートなど純正 UI が向く箇所への部分導入が現実的。
universal 層の Web 側はまだ experimental。

### その他の拾いどころ

- **EAS Update バイトコード差分**: SDK 56 以降は自動で有効。追加作業なし
- **EAS Observe（GA 済み）**: 起動・遷移パフォーマンスと JS エラー・
  ネイティブクラッシュの本番計測。Sentry と併用するか要検討
- **NativeWind v5 + Tailwind v4**: 現行は v4 + Tailwind v3。
  スタイル基盤の移行は SDK とは独立した判断
- **expo-sharing の受信共有**（SDK 55〜、experimental）: 他アプリからの
  共有インテントを受けられる。名刺交換まわりで将来的に使える可能性
- **expo-app-intents**（SDK 58、alpha）: Siri/Shortcuts 連携。優先度は低い

## 前提が変わったら

- Expo Go 運用に戻す判断をするなら、SDK 57+ は Expo Go での
  ログイン必須化に注意（dev client 前提なら無関係）
- iOS 27 / Xcode 27 環境でビルドするなら SDK 58（または 57.0.23+ の
  scene サポート有効化）が必須。古い SDK のまま Xcode 27 に上げると
  アプリが起動しない
- SDK 58 直行で想定外の破壊に当たった場合は、57.0.17+ への退避を
  フォールバック先にする（無破壊リリースなので戻りやすい）
