# 11 UI/UX 全面改善（appllama 監査に基づく刷新）

## 概要

appllama-app-design-skill の法則群（ネイティブフィデリティ・ナビゲーション・
anti-slop・モーション）に照らして `apps/mobile` 全体を監査したところ、
「ラッパー感」の原因となる構造的問題と、統一感を欠く細部が複数見つかった。
本書は全面改善の方針とフェーズ分割を定める。作業の実施・進捗管理は
issue #395 で行う。

- 監査日: 2026-10-31
- スコープ決定: ユーザーとの対話で確定（下記「決定事項」）

## 監査で見つかった問題

| # | 問題 | 違反する法則 |
| --- | --- | --- |
| 1 | 全画面 `headerShown: false` でタイトルを手書き Text 実装。large title・ネイティブ戻るボタン・ヘッダーブラーなし | タイトルはナビゲーターに持たせる |
| 2 | light は `gray-*`・dark は `slate-*` とグレー2系統 | グレーは1ファミリー |
| 3 | ボタンラベル・シート・フォールバックに絵文字（約10箇所） | アイコンは絵文字ではなくシンボル |
| 4 | `expo-haptics` 未導入。保存・削除・吸着に触覚フィードバックなし | ハプティクスは句読点 |
| 5 | `elevation`/`shadow*` が28箇所 | shadow は `boxShadow` |
| 6 | サインアウトがホーム最下部、名刺導線がホーム/プロフに分散 等 | 1意図1導線 |

## 決定事項（スコープ）

- **グレーは slate（青み）に統一**。dark 側が既に slate のため、light 側を
  slate スケールへ置き換える（`gray-*` 約318箇所 + `lib/theme/colors.ts`）
- **タブアイコンは Ionicons のまま**（NativeTabs 化で見た目を変えないという
  既存の意図的決定を尊重）
- **コンテンツ内アイコンも Ionicons に統一**。`expo-image` の `sf:` は
  Web で描けず、タブ決定とも整合するため。SF Symbols 化は将来 iOS 専用で
  検討可能（「前提が変わったとき」参照）
- **対象はアプリ全体**（4タブ + tier 表・名刺エディタ等のサブ画面）
- **Web 版も揃える**（JS Stack ヘッダーに同オプション適用）
- **没入型ツール画面は例外**：`meishi/edit`、各種 tier 表、QR スキャンは
  `headerShown: false` + 既存カスタムクロムを維持（動画編集アプリの
  全画面エディタと同じ文法）

## 採用した進め方：案A（基盤先行・フェーズ分割）

全画面に効く横断変更を先に終わらせ、画面別リデザインを後にする。

不採用案:

- **案B（画面縦断スライス）**: 1画面ずつ完結させる案。`gray→slate` のような
  横断変更が全画面 PR で重複し、コンフリクトとレビュー負荷が大きいため不採用
- **案C（デザインシステム先行）**: 共通部品を全部作ってから画面を置き換える案。
  画面数（30+）に対して初期投資が大きく、序盤に成果が見えにくいため不採用。
  共通部品は Phase 1/4 で必要なものだけ随時作る

## Phase 1: 基盤トークン

- `gray-*` → `slate-*` の機械置換（Tailwind の gray/slate は同じ段数で
  近似値。gray-50 #f9fafb→slate-50 #f8fafc など）
- `lib/theme/colors.ts` の light 側を slate スケールへ書き換え。
  `colors.unit.test.ts` のコントラスト検証を slate 値で更新し、AA を担保
- `elevation`/`shadow*` → `boxShadow`（RN 0.88 + New Arch で両 OS 対応）
- `expo-haptics` を依存に追加し、`lib/haptics.ts` に薄いラッパー
  （iOS のみ発火、Android/Web は no-op）
- `components/ui/Button.tsx` を新設（primary/secondary/destructive、
  Pressable + 押下時フィードバック）。既存 TouchableOpacity の全面置換は
  Phase 4 で各画面を触るときに随時行う

## Phase 2: ネイティブヘッダー化

- 各タブをディレクトリ化して内部に Stack をネスト。タブルート画面は
  `headerLargeTitle: true`、以深は `headerLargeTitle: false`
- root Stack のサブ画面は `headerShown: true` にし、テーマ色に揃えた
  `headerTintColor` / `headerTitleStyle` / `headerShadowVisible: false` を
  `screenOptions` に集約。手書きタイトルと `BackButton` を除去
- **`index` タブの URL 互換は冒頭で spike 検証**（`/` が `(tabs)/index` に
  解決される構造を保てるか。壊れるなら `app/index.tsx` の Redirect で吸収）
- 没入型ツール画面（名刺エディタ・tier 表・QR スキャン）は対象外
- Web の JS Stack ヘッダーにも同オプションを適用

## Phase 3: 仕上げ横断

- 絵文字10箇所を Ionicons に置換
  （🎨→color-palette-outline、📷→qr-code-outline、🍎→wallet-outline 等）
- ハプティクス適用：保存成功=notification success、削除=warning、
  セグメント/ピッカー切替=selection、tier ドロップ吸着=light impact。
  スクロール中・連続イベントには付けない
- `SegmentedControl` を `@expo/ui` のネイティブ segmented picker に置換
  （GroupedList と同じく native は `@expo/ui`、web は既存チップ維持。
  API の有無は実装時に確認し、無ければ見た目だけ iOS 準拠に整形）

## Phase 4: 画面別リデザイン

ホーム → プロフィール → ライブラリ → ソーシャル → サブ画面の順。
Appllama MCP は未接続のため、AniList・Letterboxd・MAL 公式アプリ等の
既知パターンを参照に各画面を再設計する。画面ごとに
「実装 → シミュレータ確認（light/dark・フルモーションパス）」の
ループを回し、スクリーンショットで目視確認してから次へ進む。

ホームで確定している方向性の例:

- サインアウトをプロフィール側の設定群へ移動
- 名刺プレビューをヒーロー要素として扱い、CTA のラベルを1意図1表現に整理

## 検証ゲート（各 Phase 終了時）

- `vp run typecheck` / `lint` / `fmt:check` / `test`
- Phase 2・4 の PR マージ前は `vp run @animeishi/mobile#e2e:ios` を
  ローカルで通し、結果を PR コメントに残す（AGENTS.md の定め）
- light/dark 両テーマの目視確認（シミュレータスクリーンショット）

## 前提が変わったとき

- **Web 版を捨てる決定が出た場合**: コンテンツ内アイコンを `sf:`（iOS）/
  Material Symbols（Android）に分け、iOS のフィデリティを一段上げられる
- **`@expo/ui` の segmented picker が未提供の場合**: 既存 SegmentedControl を
  iOS 純正の見た目（トラック+選択セル）に整形して代替する。ネイティブ化は
  将来のフォローアップ
- **Phase 2 でナビ再編が想定より大きい場合**: タブ内 Stack 化とサブ画面
  ヘッダー化を別 PR に分割する。`headerShown` の一括有効化だけは避け、
  画面単位で段階適用する
- **E2E がヘッダー前提で壊れる場合**: Maestro フローの画面認識
  （タイトル要素の参照方法）を先に修正してからヘッダー化作業に入る
