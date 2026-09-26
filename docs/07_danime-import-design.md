# 07. dアニメストア視聴履歴インポート設計

Issue: https://github.com/KOU050223/animeishi/issues/83

## 目的

dアニメストアの視聴履歴・コンプリート作品を取り込み、対応する Annict 作品に
視聴ステータスを登録する。

- `mpa_cmp_pc`（コンプリート作品）→ `WATCHED`
- `mpa_hst_pc`（視聴履歴、コンプリート済みを除く）→ `WATCHING`

## 全体構成

```
[native] danime-import.native.tsx (react-native-webview) ─┐
                                                        ├→ Workers API ─→ Annict GraphQL + D1
[web]    danime-import.web.tsx   (ブックマークレット+貼付)─┘
```

## dアニメからのデータ取得

### 前提（調査済み）

- `mpa_hst_pc` / `mpa_cmp_pc` は未ログインで `/animestore/auth` → dアカウント
  OIDC へリダイレクトされる。サーバーが代理で取りに行くにはユーザー固有の
  認証済みセッションが必要 → **API 経路では取得しない**。
- 両ページはサーバーサイドレンダリングのページング。`form[name=pageForm]` の
  hidden input（`workType` / `editModeFlag` / `selectPage` 等）を丸ごとクエリ化して
  `?selectPage=N` で GET すると N ページ目の完全な HTML が返る
  （外部拡張 d-tweaks の実測ベース）。総ページ数は `.paging .onlySpLayout` の
  `1 / N` 表記から読む。
- 作品カードは `.itemWrapper:not(.onlySpLayout) > .itemModule`。
  workId は `input.workId` またはリンクの `workId=` クエリ、話数は `partId=`
  クエリ、タイトルは `section > header p.line2` / `.textContainer h3.line2`。
- CSP `frame-ancestors https://animestore.docomo.ne.jp` により外部 iframe は不可。
  ネイティブ WebView のトップレベル遷移は影響を受けない。

### 抽出コア

`apps/mobile/lib/danime/extractScript.ts` の `DANIME_EXTRACT_SCRIPT` が本体。
2 経路で共用する:

- **native**: `injectJavaScript` で animestore ドメイン上に注入。
  `window.ReactNativeWebView.postMessage` で結果を受領。
- **web**: ブックマークレット（`buildDanimeBookmarklet()`）。ReactNativeWebView が
  無い環境では結果 JSON をクリップボードへコピー → 画面に貼り付け。

スクリプトは同一オリジンの `fetch`（セッション Cookie 付き）+ `DOMParser` で
全ページを取得するため、WebView 自体の画面遷移は不要。認証情報は
アプリ・Animeishi API のどちらにも送信されない。

エラーコード: `not_logged_in`（auth リダイレクト検出）/ `empty_result`
（構造変更疑い）/ `HTTP xxx`。

### 集約

クライアント側（`lib/danime/aggregate.ts`）で話数カードを作品単位に集約し、
completed 優先で targetState を割り当ててから match API に送る。

## API

### `POST /me/import/danime/match`

- 入力: `{ works: [{ danimeWorkId, title, targetState }] }`（最大 500）
- Annict `searchWorks` は `titles: [String!]` が OR 部分一致なので、
  タイトルを 10 件チャンクで union 検索し（`searchAnnictWorksByTitles`）、
  各入力への帰属はローカルのスコアリングで行う。union の `first:50` 打ち切りで
  候補を取りこぼした `none` だけ単発再検索（元タイトル→単純化タイトル）。
- スコアリング（`lib/danime/titleNormalize.ts`）:
  NFKC 正規化 → 完全一致の単一候補のみ `exact`。それ以外は類似度 0.5 以上を
  `candidates`、ゼロなら `none`。
- 出力: `{ results: [{ danimeWorkId, title, targetState, status, work, candidates }] }`

### `POST /me/watch-histories/bulk`

- 入力: `{ entries: [{ annictWorkId, nodeId?, state, work }] }`（1 リクエスト最大 50）
- 各エントリを逐次処理: `nodeId` を入力→D1 キャッシュ→`searchWorks` で解決し、
  `updateAnnictStatus` が成功した作品だけ `annict_works` / `watch_history` を
  upsert（既存 PUT と同じ「Annict が正・成功後のみキャッシュ追従」の不変条件）。
- Annict 401（トークン失効）は残りを `aborted` で打ち切り。5xx 等は該当作品のみ
  失敗として続行。`{ results: [{ annictWorkId, ok, error? }], aborted }` を返す。

## レビュー UI（ハイブリッド）

`app/danime-import-review.tsx`:

- `exact` → 既定チェック ON
- `candidates` → 候補タップで選択
- `none` → スキップ表示
- Annict 現在ステータスとの突き合わせ:
  - 同一ステータス登録済み → 既定で除外
  - `WATCHED` → `WATCHING` のダウングレード → 既定で除外
- 確定分を 50 件ずつ bulk POST。進捗 `done/total` と失敗件数を表示。

## 既知の制約 / 今後

- dアニメ側の HTML 構造変更で抽出が壊れ得る（`empty_result` で検知して通知）。
- docomo ログインが WebView で弾かれる場合は実機検証が必要。
- `none` 作品の手動検索紐付けは未実装（別途検討）。
- Web の貼り付け UX は簡易版。ブラウザ拡張経路などは別 issue 候補。
