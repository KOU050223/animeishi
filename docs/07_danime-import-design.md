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

`packages/danime-core` の `DANIME_EXTRACT_SCRIPT` が本体。
抽出・集約・検証・タイトル照合のコアロジックは framework 非依存の
`packages/danime-core`（`@animeishi/danime-core`）に切り出してあり、
mobile・API が同じ実装を共有する。2 経路で共用する:

- **native**: `injectJavaScript` で animestore ドメイン上に注入。
  `window.ReactNativeWebView.postMessage` で結果を受領。
- **web**: ブックマークレット（`buildDanimeBookmarklet(appOrigin)`）。
  ReactNativeWebView が無い環境では、抽出完了前に Animeishi の受信タブ
  （`/danime-import?recv=1`）を `window.open` で同期オープンし
  （ポップアップブロック対策）、抽出結果を `postMessage` で転送する。
  受信側は animestore オリジンからの `animeishi:danime-data` のみ受理し、
  `animeishi:danime-ack` を返すまで送信側が 500ms 間隔で再送。
  15 秒で ack が来ない・タブが開けない場合はクリップボード貼り付けに
  フォールバックする。

スクリプト冒頭で `location.hostname` を検査し、dアニメ以外のページで
実行された場合は `wrong_page` を即返す（cross-origin fetch の CORS 失敗を
分かりやすい案内に変換するため）。

スクリプトは同一オリジンの `fetch`（セッション Cookie 付き）+ `DOMParser` で
全ページを取得するため、WebView 自体の画面遷移は不要。認証情報は
アプリ・Animeishi API のどちらにも送信されない。

エラーコード: `not_logged_in`（auth リダイレクト検出）/ `empty_result`
（構造変更疑い）/ `wrong_page`（dアニメ以外のページで実行）/ `network_error`
（fetch reject）/ `HTTP xxx`。

抽出ペイロードは `{ schemaVersion, completed, history }` の versioned contract
（`DANIME_EXTRACT_SCHEMA_VERSION`）。消費側は `parseDanimeExtractedLists` で
検証し、未付与は現行扱い、未知のバージョンは弾く。

### 集約

クライアント側（`@animeishi/danime-core` の `toMatchWorks`）で話数カードを
作品単位に集約し、completed 優先で targetState を割り当ててから match API に送る。

## API

### `POST /me/import/danime/match`

- 入力: `{ works: [{ danimeWorkId, title, targetState }], registeredWorkIds? }`
  （works は最大 500）
- dアニメの冠+「」包みタイトル（`TVアニメ「X」` 等）は照合前に
  `unwrapDanimeTitle` で外す（`劇場版`・`映画`・`OVA` 系の冠は Annict 側にも
  付くため残す）。一般名詞のみの退化クエリ（`TVアニメ` だけ等）は
  Annict に送らない（`K` のような 1 文字作品は検索対象とし、
  部分一致のノイズはスコアリングで弾く）。
- Annict 検索は core の `AnnictSearcher` として注入する
  （API 側は `searchAnnictWorksByTitles` を包んで渡す。将来のスタンドアロン版は
  Annict 直叩き実装に差し替えられる）。
- Annict `searchWorks` は `titles: [String!]` が OR 部分一致なので、
  タイトルを 10 件チャンクで union 検索し（`searchAnnictWorksByTitles`）、
  各入力への帰属はローカルのスコアリングで行う。`exact` 以外は単発再検索する
  （union の `first:50` 打ち切りや、同じ検索語を共有する無印作品が先に
  候補へ入る取りこぼしを救うため。`none` には全バリアントを、
  `candidates` には全半角バリアントのみ試す）。再検索語は
  「元タイトル → 全角英数→半角 → 半角数字→全角 → 映画↔劇場版の冠バリアント
  → 単純化タイトル」の順に試す（`title_cont` が LIKE のため数字の
  全半角違いや「映画」「劇場版」の表記揺れでヒットしないケースを救う）。
  再検索語でヒットした候補の分類も検索語で行うが、期数ガードと
  登録済み除外は元の入力タイトルで判定する（単純化で期数が消えた
  検索語経由でも別シーズンを自動確定しない）。
- 並列化と計測（issue #115）: union 検索チャンクと未解決タイトルの再検索は
  同時実行数 6 の `mapWithConcurrency`（`packages/danime-core/src/concurrency.ts`）
  で並列実行する（1 タイトル内の再検索語だけは順序依存のため逐次）。
  API 側は注入する `AnnictSearcher` を `withAnnictRetry`
  （`services/api/src/lib/annict/retry.ts`）で包み、429 / 5xx / 通信失敗を
  最大 3 回までバックオフ再試行する。リトライ回数は API 側で集計して
  stats に含める。第 2 パスの往復上限（`MAX_SECOND_PASS_SEARCHES = 50`）は
  並列タスク間で共有するが、全タスクを一括並列化すると先のタスクの
  検索が遅い間に後続タスクが枠を先食いして先の検索語を枯渇させるため、
  再検索は同時実行数ぶんずつのウェーブで進める（先のウェーブが完了して
  から次を開始し、逐次版と同じ入力順の優先度を保つ）。
- スコアリング（`packages/danime-core/src/titleNormalize.ts`）:
  NFKC 正規化 → 完全一致の単一候補のみ `exact`（入力が期数を明示している
  ときは、期数の一致しない候補は exact にしない）。それ以外は類似度
  0.5 以上を `candidates`（最大 10 件）、ゼロなら `none`。
  劇場版・番外編等のメタ差分や、両側で判明して食い違う期数は類似度から
  減点し、別シーズン・別エディションが上位に来ないようにする。
  `registeredWorkIds`（クライアントの既存ライブラリ）が渡された場合、
  入力が期数を明示していて「登録済みかつ別シーズンと判明している」候補は
  候補から除外する（候補側の期数が不明なときは残す）。
- 出力: `{ results: [{ danimeWorkId, title, targetState, status, work, candidates }], stats }`
  - `stats`: `{ firstPassSearches, secondPassSearches, retries, elapsedMs }` —
    検索回数・リトライ回数・経過時間の観測情報。構造化ログ
    （`event: "danime_match"`）にも同内容を出す。

### `POST /me/watch-histories/bulk`

- 入力: `{ entries: [{ annictWorkId, state }] }`（1 リクエスト最大 50）
- **nodeId・作品メタはクライアントから受け付けない**（共有キャッシュ
  `annict_works` の汚染と別作品への誤登録を防ぐため）。サーバー側で
  D1 キャッシュ → `searchWorks` の順に正規解決する（既存 PUT と同じ経路）。
- 各作品は同時実行数 4 で並列処理し、Annict 呼び出しは `withAnnictRetry` で
  429 / 5xx / 通信失敗をリトライする（updateStatus は冪等）。同一
  `annictWorkId` の重複エントリは並列化の前に「入力順最後の状態」へ
  集約する（並列だと Annict 反映順と D1 保存順が逆転し得るため、
  逐次実行時代の後勝ちと同じ結果に揃える）。また想定外の例外
  （D1 書き込み失敗等）は `internal_error` としてその作品だけの失敗に
  変換し、バッチ全体を reject しない（応答後も他ワーカーの更新が
  続いてクライアント表示と実態が食い違うのを防ぐ）。
- `updateAnnictStatus` が成功した作品だけ `annict_works` / `watch_history` を
  upsert（「Annict が正・成功後のみキャッシュ追従」の不変条件）。
- Annict 401（トークン失効）を検知したら未着手の作品を `aborted` で打ち切る
  （処理中の分は実結果を返す）。5xx 等は該当作品のみ失敗として続行。
  `{ results: [{ annictWorkId, ok, error? }], aborted, elapsedMs }` を返し、
  構造化ログ（`event: "watch_history_bulk"`）にも件数と経過時間を出す。
- クライアントは後続チャンクが送られなかった分を `aborted`/`not_sent` として
  結果に含め、部分失敗でも履歴キャッシュを無効化する。

## レビュー UI（ハイブリッド）

`app/danime-import-review.tsx`:

- `exact` → 既定チェック ON
- `candidates` → 候補タップで選択
- `none` → スキップ表示
- Annict 現在ステータスとの突き合わせ:
  - 同一ステータス登録済み → 既定で除外
  - `WATCHED` → `WATCHING` のダウングレード → 既定で除外
- 確定分を 50 件ずつ bulk POST。進捗 `done/total` と失敗件数を表示。
- 所要時間の可視化: 抽出スクリプトが payload に載せる `extractElapsedMs`、
  照合のクライアント計測時間 + API `stats`、登録の経過時間を
  「抽出 / 照合 / 登録」のサマリとしてレビュー・結果画面に表示し、
  照合中・登録中は経過秒数をライブ表示する。

## 既知の制約 / 今後

- dアニメ側の HTML 構造変更で抽出が壊れ得る（`empty_result` で検知して通知）。
- docomo ログインが WebView で弾かれる場合は実機検証が必要。
- `none` 作品の手動検索紐付けは未実装（別途検討）。
- Web は初回のみブックマーク登録が必要（ブラウザの仕組み上ワンクリック化の
  下限）。ブラウザ拡張経路は別 issue 候補。
