# 06 名刺エディタ設計（簡易Figma風）

## 概要

現状の名刺（`MeishiCard`）は固定レイアウトで、背景色・レイアウト・アバター形状などの表面的な設定しか変えられない。この設計では **キャンバス上に要素を絶対配置し、ユーザーが要素を追加/削除/変形して自由に名刺を組める "簡易Figma" 風のエディタ** に置き換える。

MVPスコープと第2弾以降のスコープを明確に分離し、実装可能なサイズに絞る。

- 設計対話: 2026-07-02、20問のインタビュー形式で確定
- 実装トラッキング issue: TBD（このドキュメント作成と同時に起票）

---

## MVPスコープ

### コアコンセプト

- 自由レイアウト（キャンバス上に要素を絶対配置し、ドラッグ/リサイズ/回転で編集）
- 要素を追加/削除/複製できる（テンプレの範囲を超えて構造を変えられる）
- モバイル前提のUI設計（Figma風UIを模倣するのではなく、モバイルで自然な操作モデル）

### キャンバス

- **横向き固定**、アスペクト比固定（初期案: 1.6:1）
- **正規化座標系（0.0〜1.0）** で位置・サイズを保存
  - 表示時に画面幅にスケール → デバイスサイズ差に強い
  - 一覧のサムネ・将来の他人向け公開HTMLでも同じ比率でレンダリング可能
- 背景: `BackgroundStyle`（単色 / グラデーション / パターン）を継承

### 要素の種類（6種）

MVPで置ける要素は以下:

| # | type            | 説明                                                              |
| - | --------------- | ----------------------------------------------------------------- |
| 1 | text            | 自由入力 or プロフィール項目バインド（username/bio/favoriteQuote）|
| 2 | image           | アバター / 任意アップロード / アニメ画像（source で分岐）         |
| 3 | shape           | 矩形・円（塗り/枠線/角丸）                                        |
| 4 | qr              | プロフィールURL or 自由入力                                       |
| 5 | animeCollage    | 視聴履歴コラージュ（sortBy/limit/gap、実データは動的取得）        |
| 6 | animeCountBadge | 視聴数バッジ（prefix/suffix + metric、実カウントは動的取得）      |

（text と image はそれぞれ source フィールドで内部種別を切り替えるが、
判別共用体としての type は 6 種類）

### プロフィール項目バインド（動的解決）

- `text.source = "username" | "bio" | "favoriteQuote"` のとき、レンダー時に `profile.*` から解決
- `text.source = "custom"` のときは `text.text` の文字列をそのまま表示
- 名刺は「今の自分」を映すもの → プロフィールを更新すると名刺も自動追従する
- QRの `source = "profile"` も同様、レンダー時にプロフィールURLを解決

### 操作モデル

- **移動**: 選択枠内をドラッグ
- **リサイズ**: 4角のハンドルをドラッグ / ピンチジェスチャ
- **回転**: 上辺の外に飛び出た回転ハンドル / 2本指回転ジェスチャ
- **重なり順変更**: 選択要素に「↑最前面へ」「↓最背面へ」ボタン
- **Undo/Redo**: コミット単位（ジェスチャの onEnd、プロパティ確定時に1コミット）、履歴上限50、メモリのみ

**ハイブリッドUI**: 視覚的なハンドル（Figma式）+ ネイティブジェスチャ併用。モバイルの精密操作と直感操作を両立。

### エディタUI

- **専用ルート `/meishi/edit`**（`apps/mobile/app/meishi/edit.tsx`）
- **コンテキスト表示**:
  - 未選択時: 下部に「＋要素を追加」のみ、キャンバス面積最大化
  - 選択時: 下部に選択要素のプロパティ + 削除・複製・重なり順ボタン
- **ヘッダー**: 戻る / タイトル / Undo / Redo / **保存**
- **左上フローティング**: 「≡」レイヤー一覧トリガー
- **テキスト編集**: プロパティパネル上部の「文字列: {現在の値} ✏️」タップ → 下から編集シート → TextInput + 完了ボタン
  - インライン編集（ダブルタップで要素上に TextInput 重ね）はモバイルでは回転・拡縮との相性が悪いためスコープ外

### エディタの入り口

- プロフィール画面: 現状のプレビュー `MeishiCard` を維持 → 下に「🎨 名刺をデザインする」ボタン
- タップで `/meishi/edit` へ遷移
- 戻ると、プロフィール画面のプレビューが最新の名刺JSONで更新

### テンプレート

- 初回起動時（保存済み名刺JSONが無い時）: **テンプレ選択画面** を表示
- MVPのテンプレ: **白紙 + 4個**（クラシック / サンセット / ミッドナイト / さくら）
- ヘッダーに「テンプレ」ボタン → いつでも再度テンプレ選択画面を開ける（現在の作業は上書き警告付き）
- 各テンプレは要素配置込みの `MeishiDocument` としてコード内定数で持つ

### フォント

- **Expo Google Fonts で5書体組み込み**（可変フォント + 動的ロード）
  - Noto Sans JP（ゴシック標準）
  - Noto Serif JP（明朝・上品）
  - M PLUS Rounded 1c（丸ゴシック）
  - RocknRoll One（インパクト系）
  - Shippori Mincho（伝統的明朝）
- ロード中はシステムフォントで代替表示
- Web/iOS/Android で同一書体を提供

### 保存フロー

- **編集中**: AsyncStorage 自動保存（コミット単位）→ ドラフト保護
- **サーバ送信**: ヘッダー「保存」ボタン明示タップのみ
  - `PUT /me/meishi` に JSON を送る
  - 成功トースト「名刺を保存しました」
- プロフィール画面のプレビューは AsyncStorage の最新状態を表示
- **Undo履歴**: メモリのみ、アプリ再起動でリセット

### アセット（画像）

- 任意アップロード画像は **R2 に個別アップロード**
  - 既存アバターアップロード（`services/api/src/routes/me.ts`）と同じ流儀
  - `expo-image-picker` → 既存の `imageCompression.ts` で圧縮 → `POST /me/meishi-assets` → R2 → 配信URL返却 → `element.uri` に保存
- アニメ画像は Annict由来のポスターURLを直接保存（R2に上げ直さない）
- 削除された要素の画像は R2 に残す（オーファンGCは第2弾）

---

## データ構造

```ts
// 全要素共通
type Transform = {
  x: number;        // 0.0〜1.0 正規化（キャンバス幅比）
  y: number;        // 0.0〜1.0 正規化（キャンバス高比）
  width: number;    // 0.0〜1.0 正規化
  height: number;   // 0.0〜1.0 正規化
  rotation: number; // 度（0〜360）
};

type FontWeight = "normal" | "bold" | "black";
type FontStyle = "normal" | "italic";
type FontFamily =
  | "system"
  | "notoSansJp"
  | "notoSerifJp"
  | "mPlusRounded"
  | "rocknRoll"
  | "shipporiMincho";

type BackgroundStyle =
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string; angle?: number }
  | {
      kind: "pattern";
      base: string;
      accent: string;
      pattern: "dots" | "stripes" | "grid";
    };

// Discriminated Union
type MeishiElement =
  | {
      id: string;
      type: "text";
      transform: Transform;
      text: string;
      source: "custom" | "username" | "bio" | "favoriteQuote";
      fontSize: number;
      fontFamily: FontFamily;
      fontWeight: FontWeight;
      fontStyle: FontStyle;
      color: string;
      align: "left" | "center" | "right";
    }
  | {
      id: string;
      type: "image";
      transform: Transform;
      uri: string;
      source: "avatar" | "upload" | "anime";
      shape: "rect" | "circle" | "rounded";
      objectFit: "cover" | "contain";
    }
  | {
      id: string;
      type: "shape";
      transform: Transform;
      shape: "rectangle" | "circle";
      fill: string;
      stroke: string;
      strokeWidth: number;
      cornerRadius: number;
    }
  | {
      id: string;
      type: "qr";
      transform: Transform;
      source: "profile" | "custom";
      data: string; // source=custom の時だけ使う
      fgColor: string;
      bgColor: string;
    }
  | {
      id: string;
      type: "animeCollage";
      transform: Transform;
      cols: number;
      rows: number;
      sortBy: "recent" | "popular";
      limit: number;
      gap: number;
    }
  | {
      id: string;
      type: "animeCountBadge";
      transform: Transform;
      metric: "watched" | "favorites";
      prefix: string;
      suffix: string;
      fontSize: number;
      fontWeight: FontWeight;
      fontFamily: FontFamily;
      color: string;
      bgColor: string;
    };

type MeishiDocument = {
  version: 1;
  canvas: {
    aspectRatio: number;      // 幅/高。MVP は 1.6 固定
    background: BackgroundStyle;
  };
  elements: MeishiElement[];  // 配列順 = zIndex（末尾が最前面）
};
```

**設計方針:**

- 配列順で重なり順を表現し、別途 zIndex を持たない
- `id` は複製・並び替え・Undo に必須（`crypto.randomUUID()` 相当）
- `version` は将来のマイグレーション余地を残す
- `source` フィールドで動的バインドの意図を保存（実データはレンダー時に解決）

---

## サーバ設計

### DBスキーマ変更

`users` テーブルに 2 カラム追加（別テーブルではなく1:1で持つ）:

```sql
ALTER TABLE users ADD COLUMN meishi_document TEXT;
ALTER TABLE users ADD COLUMN meishi_public INTEGER NOT NULL DEFAULT 0;
```

- `meishi_document`: JSON 文字列
- `meishi_public`: 将来の公開フラグ（MVPでは常に 0 固定、UIから変更不可）
  - 第2弾で「公開トグル」+ `/user/:id` HTMLへの名刺JSONレンダリングを追加するときに使う
  - MVPからカラムを用意しておくことで、公開機能追加時にマイグレーション不要

### APIエンドポイント

新規:

- `PUT /me/meishi` — 名刺JSONを保存
  - リクエストボディ: `MeishiDocument` の Zod validated JSON
  - サイズ上限: **32KB**（超過は 413）
  - レスポンス: 保存済み Document
- `POST /me/meishi-assets` — 名刺用画像を R2 にアップロード
  - リクエスト: multipart/form-data（既存 avatar と同流儀）
  - サイズ上限: **500KB**（圧縮後）
  - レスポンス: `{ url: string }`

既存: `PUT /me`（プロフィール本体）はそのまま。名刺JSONとは別更新経路。

### バリデーション

`services/api/src/schema/validators.ts` に `MeishiDocument` の Zod スキーマを追加:

- `z.discriminatedUnion("type", [...])` で要素の型安全性を担保
- 色は `#[0-9a-fA-F]{6,8}` でバリデーション
- 数値は `min/max` で異常値を弾く（座標 0〜1、角度 0〜360、fontSize 8〜200 等）
- 文字列は URLインジェクション対策で既存の `commentSchema` の流儀を継承

---

## MVPスコープ外（第2弾以降）

明示的に落としたもの:

- **サーバ公開HTMLへの名刺JSON反映**（`/user/:id` は既存のプロフィール要素のみ）
- **画像/PDF書き出し・SNS共有**
- **`meishi_public` トグルの UI**（DBカラムだけ用意、UIは第2弾）
- **スナップ機能**（ガイドライン、中央線吸着、他要素吸着）
- **マルチ選択・グループ化**
- **アニメ関連の追加要素**（好きな1シーンの引用ボックス、縦書きアニメタイトル）
- **Annict作品検索から画像追加**（お気に入り経由のみ）
- **R2 オーファン画像のGC**
- **ユーザーによる任意フォント追加**
- **キャンバスサイズ・アスペクト比の変更**（横向き固定）
- **Undo履歴の永続化**（メモリのみ）
- **ダブルタップでのインライン文字編集**（シート編集のみ）
- **常時サーバ同期**（明示的な保存ボタンのみ）
- **他人の名刺閲覧（QR経由の公開閲覧UI）**

---

## 既存実装の扱い

- 前回の `apps/mobile/components/MeishiCustomizer.tsx` と `apps/mobile/lib/useMeishiCustomization.ts` は **削除して仕切り直し**
- 前回の `apps/mobile/lib/meishiCustomization.ts` のうち以下は流用:
  - `BackgroundStyle` 型（新設計の `canvas.background` に採用）
  - `COLOR_PALETTE`（新エディタのカラーピッカーで再利用）
  - `MEISHI_PRESETS` は名前だけ流用し、中身は要素配置込みの `MeishiDocument` テンプレとして作り直す
- `apps/mobile/components/MeishiCard.tsx` は**レンダリング専用**に作り替え（`MeishiDocument` を受け取って表示する純関数コンポーネント）。編集機能はエディタ画面に分離
- `apps/mobile/app/(tabs)/profile.tsx` はカスタマイザーUIを削除し、`MeishiCard` プレビュー + 「名刺をデザインする」ボタンだけの状態に戻す

---

## 実装フェーズ案

1. **基盤**: 型定義、AsyncStorage永続化、テンプレ定義、`MeishiCard` を Document ベースに書き直し
2. **エディタ画面骨格**: ルート追加、ヘッダー、キャンバス表示、コンテキスト表示切替
3. **要素追加**: 追加シート、7種の要素追加動線
4. **操作**: 移動 → リサイズ → 回転 の順で1つずつ
5. **プロパティパネル**: 要素種別ごとの編集UI
6. **Undo/Redo**: 履歴スタック
7. **サーバAPI**: マイグレーション、`PUT /me/meishi`、`POST /me/meishi-assets`、Zod validation
8. **保存フロー**: ヘッダー「保存」ボタン → サーバ送信
9. **フォント**: Expo Google Fonts 5書体組み込み、動的ロード

各フェーズを個別 PR に分割することを推奨（`docs/02_pr-split-plan.md` の流儀）。
