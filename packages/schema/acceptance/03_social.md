# 受け入れ基準: QR・フレンド・SNS・プロフィール・名刺・Viewer・Gemini

## QR 生成

| # | 入力 | 期待結果 |
|---|---|---|
| QG-01 | QR 生成画面初期表示 | ログインユーザーの ID を埋め込んだ QR を表示 |
| QG-02 | QR の内容 | `https://animeishi.app/user/{userId}` または `animeishi://user/{userId}` 形式 |
| QG-03 | 「画像として保存」タップ | QR 画像がフォトライブラリに保存される |
| QG-04 | Web でのQR生成 | `@zxing/browser` 経由で表示 |
| QG-05 | カスタムテキスト空で生成 | エラー「テキストを入力してください」|
| QG-06 | ブランドカラーQR | foreground が #667EEA で再描画される |

## QR スキャン / フレンド追加

| # | 入力 | 期待結果 |
|---|---|---|
| QS-01 | 有効な URL 形式 QR をスキャン | userId を抽出し `POST /me/friends` を呼ぶ |
| QS-02 | `animeishi://user/{uid}` をスキャン | 同上 |
| QS-03 | 28文字 UID の QR をスキャン | 同上 |
| QS-04 | 自分の QR をスキャン | エラー「自分のQRコードはスキャンできません」|
| QS-05 | 既にフレンドの QR をスキャン | エラー「既にフレンドです」|
| QS-06 | 存在しないユーザーの QR をスキャン | エラー「このユーザーは存在しません」|
| QS-07 | 28文字以外の英数字 QR | エラー「無効なQRコードです」|
| QS-08 | 無関係な URL QR | エラー「無効なQRコードです」|
| QS-09 | スキャン成功 | 双方の `friendships` に行が追加される（双方向）|
| QS-10 | 1秒以内の重複スキャン | 無視される（重複登録なし）|

## SNS / フレンド

| # | 入力 | 期待結果 |
|---|---|---|
| S-01 | SNS タイムライン表示 | フレンド一覧（username・ジャンル）が表示 |
| S-02 | フレンド 0 件 | 空状態 UI |
| S-03 | フレンドカードタップ | フレンドの視聴履歴一覧へ遷移 |
| S-04 | フレンド削除 | 確認後 `DELETE /me/friends/:id`（自分側のみ削除）|
| S-05 | 友人視聴履歴 | `GET /users/:id/watch-histories` から年月降順で表示 |
| S-06 | フレンド視聴履歴ソート | 昇順/降順トグルで切替 |

## プロフィール編集 / 画像

| # | 入力 | 期待結果 |
|---|---|---|
| P-01 | 画像ピッカーで画像選択 | `expo-image-manipulator` で WebP/512px/q70 に圧縮 |
| P-02 | 圧縮後サイズ | 平均 50KB 以下 |
| P-03 | 保存タップ | R2 Pre-signed URL に PUT 後、`profiles.meishi_image_key` 更新 |
| P-04 | ユーザー名バリデーション失敗 | バリデーションエラー表示、保存されない |
| P-05 | カラーテーマ選択 | `profile_customization.theme` に保存 |
| P-06 | お気に入りの言葉 501 文字 | エラー「コメントは500文字以内で入力してください」|
| P-07 | ジャンル複数選択 | `profiles.selected_genres` 配列に保存 |
| P-08 | メールアドレス更新 | Clerk + `profiles.email` 両方更新 |
| P-09 | プロフィール削除 | `DELETE /me/profile` で `profiles` 行削除 |
| P-10 | 画像なし状態 | プレースホルダー表示 |

## 名刺 (Home)

| # | 入力 | 期待結果 |
|---|---|---|
| M-01 | Home タブ表示 | 自分のプロフィール画像・QR・名刺画像を表示 |
| M-02 | 名刺画像未アップ | プレースホルダー表示 |
| M-03 | 名刺画像アップロード | 800×800/q90→WebP/512px/q70 に圧縮して R2 に保存 |
| M-04 | ファイル名が `meishi_{userId}_*` 以外 | R2 ルールで拒否 |
| M-05 | 名刺タップ | MeishiDetailPage へ遷移 |
| M-06 | ピンチズーム | InteractiveViewer 相当でズーム可能 |

## Viewer 公開ページ

| # | 入力 | 期待結果 |
|---|---|---|
| V-01 | `/user/{uid}` を未ログインで開く | プロフィール・視聴履歴が表示される |
| V-02 | `profiles.is_public = false` のユーザー | 非公開メッセージを表示 |
| V-03 | 存在しない uid | 「ユーザーが見つかりません」|
| V-04 | OGP タグ | og:title / og:description / og:image が正しく設定 |
| V-05 | 視聴 0 件 | 空状態 UI |

## Gemini 傾向分析

| # | 入力 | 期待結果 |
|---|---|---|
| G-01 | 正常なアニメリスト + username | 200 + `{ comment: string }` |
| G-02 | animeList が空配列 | 400 + "non-empty array." |
| G-03 | animeList が非配列 | 400 + "non-empty array." |
| G-04 | GEMINI_API_KEY 未設定 | 500 + "GEMINI_API_KEY is not set." |
| G-05 | Gemini API 失敗 | 500 + `{ error: string }` |
| G-06 | Gemini 応答が null | fallback「傾向分析コメントを生成できませんでした。」を返す |
