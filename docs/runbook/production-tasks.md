# 本番運用タスク（Taskfile）

本番・プレビュー環境を手で操作するときに読む。

本番・プレビュー環境の運用操作は、確認プロンプト（`prompt:`）やメモの安全な受け渡しが
go-task に依存しているため Taskfile.yml に残している。go-task はルートの devDependency
（`@go-task/cli`）で入るので、`pnpm task <タスク名>` で実行する（一覧は `pnpm task --list`）。

```
* db:migrate:prod:list:   本番 D1 の未適用マイグレーションを確認（非破壊）
* db:migrate:prod:        本番 D1 にマイグレーション適用（破壊的操作あり・確認プロンプト付き）
* db:migrate:preview:list: プレビュー D1 の未適用マイグレーションを確認（非破壊）
* db:migrate:preview:     プレビュー D1 にマイグレーション適用
* reports:list:           本番 D1 の通報一覧を表示（既定: 未対応のみ。issue #186）
* reports:resolve:        本番の通報を対応済みにする（確認プロンプト付き）
* reports:dismiss:        本番の通報を却下する（確認プロンプト付き）
* reports:reopen:         本番の通報を未対応に戻す（確認プロンプト付き）
* reports:list:local:     ローカル D1 の通報一覧を表示
* reports:update:local:   ローカル D1 の通報ステータスを更新（動作確認用）
* feedback:list:          本番 D1 の不具合報告・ご意見を新しい順に表示（既定 50 件）
* feedback:list:local:    ローカル D1 の不具合報告・ご意見を表示
* images:backfill:        本番の未取り込み作品画像を画像プロキシ経由で一括取り込み
* images:takedown:        本番の作品画像を削除し、以後の補完を止める（MAL の削除依頼対応。プロキシのキャッシュも Purge。確認プロンプト付き）
* articles:publish:       本番 D1 に記事を投入（確認プロンプト付き。issue #437）
* articles:publish:preview: プレビュー D1 に記事を投入
* articles:publish:local: ローカル D1 に記事を投入
* events:publish:         本番 D1 にイベントを投入（確認プロンプト付き。issue #411）
* events:publish:preview: プレビュー D1 にイベントを投入
* events:publish:local:   ローカル D1 にイベントを投入
* elections:publish:      本番 D1 に総選挙を投入（確認プロンプト付き。issue #438）
* elections:publish:preview: プレビュー D1 に総選挙を投入
* elections:publish:local: ローカル D1 に総選挙を投入
* elections:results:      本番 D1 の総選挙結果を集計して表示（読み取り専用）
* elections:results:preview: プレビュー D1 の総選挙結果を集計して表示
* elections:results:local: ローカル D1 の総選挙結果を集計して表示
```

> wrangler は `apps/api/node_modules` にのみ入っている（ルートには入れない方針）。
> ルートから叩くときは `dir: apps/api` 付きの task 経由にする。デプロイ・本番 D1 操作は
> 上記 `db:migrate:prod*` のように Taskfile に集約し、wrangler の場所を意識せず実行できるようにする。

## D1 マイグレーション

本番 D1 へのマイグレーション適用は deploy-api.yml がデプロイ前に自動で行うため、
main へのマージ後に手動で `pnpm task db:migrate:prod` を実行する必要はない。
手動タスクは手動デプロイ時や DB 再作成時のリカバリ用途で残してある。

## 通報モデレーション（reports.\*）

`apps/api/scripts/reports.sh` の Taskfile ラッパー。使い方は `bash apps/api/scripts/reports.sh --help`。
`pnpm task reports:list -- --status all`、`pnpm task reports:list -- --by-user` のように
`--` 以降でオプションを渡せる。更新系は id を `--` 以降、対応メモを
`NOTE='メモ'` で渡す（例: `pnpm task reports:resolve NOTE='対応済み' -- 5`）。
メモは環境変数経由でスクリプトに渡るため、引用符・`$`・バッククォート等を
そのまま含めてよい。プレビュー D1 を見る場合は
`bash apps/api/scripts/reports.sh --env preview list` を直接叩く。

## 不具合報告・ご意見（feedback:list）

アプリのホーム右上の吹き出しアイコン（またはサポートページ）から送られた投稿を読む。
Discord（#bot-log）には「投稿あり」と件数だけが届くので、通知を見たら
`pnpm task feedback:list` で内容を確認する。件数を変えるときは
`pnpm task feedback:list -- --limit 200`。プレビュー D1 は
`bash apps/api/scripts/feedback.sh --env preview list` を直接叩く。

## 作品画像の削除（images:takedown）

`apps/api/scripts/takedown-work-images.sh` の Taskfile ラッパー（issue #241）。
MAL API の規約により、MAL から削除依頼が来たら
MAL 由来の画像（`image_source='mal'`）を **24 時間以内**に消す必要がある。

### 準備（キャッシュ Purge 用。初回のみ）

削除の最後に、画像プロキシ前段の Workers Cache をゾーンの Purge Cache API で
消す（issue #244）。API トークンとゾーン ID が必要:

1. Cloudflare ダッシュボード → My Profile → API Tokens → Create Token で、
   **Zone → Cache Purge → Purge** 権限を `uomi.dev` ゾーンに限定して発行する
   （Workers デプロイ用の `CLOUDFLARE_API_TOKEN` とは権限が別なので別トークン）。
2. ゾーン ID は `uomi.dev` → Overview → 右カラムの API 欄「Zone ID」。
3. `apps/api/.env`（gitignore 済み。`pnpm task` が自動で読む）に書くか、
   実行シェルで export する:

   ```sh
   CLOUDFLARE_ZONE_ID=<ゾーン ID>
   CLOUDFLARE_PURGE_API_TOKEN=<発行したトークン>
   ```

### 実行

1. 作品 ID を `--` 以降に並べる（例: `pnpm task images:takedown -- 123 456`）か、
   `pnpm task images:takedown -- --all-mal` で MAL 由来の全件を対象にする。
   `--all-mal` は `image_source='blocked'` の作品も対象に含めるので、
   前回の実行で消し残した分（R2 削除・Purge の失敗、環境変数の未設定）を
   同じコマンドでやり直せる
2. 件数と一覧を表示してから確認プロンプトが出る。承認すると、対象を `image_source='blocked'`・
   `resolved_image_url` NULL にしてから、R2 のオブジェクトを消して `image_r2_key` を NULL にし、
   最後にプロキシ前段のキャッシュを Purge する
3. R2 から消せなかったキーは DB に残るので、表示された作品 ID で再実行する。
   Purge だけやり直したいときも同じ作品 ID で再実行すればよい
   （R2 削除済みの分は何も起きず、Purge だけ再走る）

`'blocked'` の作品は cron・画像プロキシ・検索のどこからも補完し直さない
（Annict の元の画像は MAL 由来ではないので、プロキシは引き続き配信する）。

### Purge の仕組みと消せなかったとき

プロキシ前段のキャッシュは Workers Cache API（`caches.default`）にあり、
Worker 内の `cache.delete()` では実行したデータセンターしか消えない。
スクリプトは代わりにゾーンの Purge Cache API
（`POST /zones/:zone_id/purge_cache`）を**タグ指定と URL 指定の両方**で呼ぶ。
タグ指定（`Cache-Tag: work-image-<id>`。Cloudflare 公式が Cache API の
エントリに効くと明記しているのはタグ指定と Purge Everything）で消せるのは
この変更のデプロイ以降に保存されたエントリ。それ以前のエントリは
URL 指定がベストエフォートでカバーし、どうしても残るものは最長 8 日の
旧 TTL で自然に切れる（`stale-while-revalidate` 込み。2026-11-03 頃まで）。

環境変数が未設定・API が失敗した場合も、D1/R2 の削除は完了したうえで
消せなかった URL の一覧が出る。そのときはダッシュボードから手動で消す:

1. `uomi.dev` → Caching → Configuration → Purge Cache → Custom Purge
2. 「Purge by: URL」を選び、表示された URL
   （`https://animeishi-api.uomi.dev/images/works/<id>`）を貼って Purge

`--local` と preview（`--env preview`）では Purge しない。
preview の API は `pr-<N>-animeishi-api-preview.*.workers.dev` で、
ゾーンの Purge API はそのゾーンに属するホスト名しか消せないため。

使い方は `bash apps/api/scripts/takedown-work-images.sh --help`。プレビューは
`--env preview`、ローカル（wrangler dev の D1・R2）は `--local` を直接付けて叩く。

## 特集記事の投入（articles:publish）

ホームの特集枠・記事詳細が読む `articles` テーブルに、frontmatter 付きの
Markdown ファイルを投入する（issue #437）。実体は
`apps/api/scripts/publish-article.mjs` で、frontmatter のパースと D1 への
upsert は `apps/api/scripts/lib/frontmatter-content.mjs` に切り分けてある
（#411 のイベント登録でも同じ仕組みを使うため）。

### Markdown ファイルの形式

記事ファイルはリポジトリに入れず、投入する人の手元で管理する
（記事のたびにリリースが要らないようにする決定。issue #437）。

```markdown
---
slug: autumn-2026                  # 必須。[a-z0-9][a-z0-9-]*。記事詳細の URL になる
title: 今期の特集                   # 必須
cover_image_url: https://...       # 省略可。特集枠のカードと詳細上部に出す画像
published_at: 2026-11-10T09:00:00+09:00    # 必須。公開開始日時（ISO 8601）
unpublished_at: 2026-12-01T00:00:00+09:00  # 省略可。公開終了日時。省略時は終了期限なし
---

本文 Markdown（# 見出し・箇条書き・リンクなど）
```

### 実行

```sh
pnpm task articles:publish -- /path/to/article.md          # 本番（確認プロンプト付き）
pnpm task articles:publish:preview -- /path/to/article.md  # プレビュー
pnpm task articles:publish:local -- /path/to/article.md    # ローカル D1
```

- 同じ slug で再投入すると上書きされる（`created_at` は初回投入時のまま）。
  本文の修正・公開期間の変更は同じ slug で再投入する
- 公開を止めたい記事は `unpublished_at` を過去日時にして再投入する
  （行の削除手段はない。公開期間外の記事は API が一覧・詳細ともに返さない）
- パスは `apps/api` からの相対か絶対パスで指定する。スペースを含むパスは
  クオートする
- ローカル D1 に投入する前に `vp run @animeishi/api#db:migrate:local` で
  `articles` テーブルが作られていることを確認する

## イベントの投入（events:publish）

アプリに出すイベント（AnimeJapan・コミケ等。issue #411）を `events`
テーブルに投入する。実体は `apps/api/scripts/publish-event.mjs` で、
特集記事（articles:publish）と同じ frontmatter 付き Markdown →
slug upsert の仕組み。

### Markdown ファイルの形式

イベントファイルはリポジトリに入れず、投入する人の手元で管理する
（記事と同じ決定。issue #437 / #411）。

```markdown
---
slug: comiket-107                     # 必須。[a-z0-9][a-z0-9-]*。イベント詳細の URL になる
title: コミックマーケット107            # 必須
starts_at: 2026-12-20T10:00:00+09:00  # 必須。会期開始（ISO 8601）
ends_at: 2026-12-21T16:00:00+09:00    # 必須。会期終了。starts_at より後
location: 東京ビッグサイト              # 省略可。会場名
official_url: https://www.comiket.co.jp/ # 省略可。公式サイト
cover_image_url: https://...          # 省略可。一覧カードと詳細上部に出す画像
published_at: 2026-11-10T09:00:00+09:00    # 必須。アプリへの公開開始日時
unpublished_at: 2026-12-25T00:00:00+09:00  # 省略可。公開終了日時。省略時は終了期限なし
---

説明文 Markdown（省略可。参加案内や注意点など。空なら詳細に本文を出さない）
```

### 実行

```sh
pnpm task events:publish -- /path/to/event.md          # 本番（確認プロンプト付き）
pnpm task events:publish:preview -- /path/to/event.md  # プレビュー
pnpm task events:publish:local -- /path/to/event.md    # ローカル D1
```

- 同じ slug で再投入すると上書きされる（`created_at` は初回投入時のまま）。
  内容の修正・公開期間の変更は同じ slug で再投入する
- 公開を止めたいイベントは `unpublished_at` を過去日時にして再投入する
  （行の削除手段はない。公開期間外のイベントは API が一覧・詳細ともに返さない）
- `starts_at`〜`ends_at`（両端を含む）は「会期中に交換した名刺」の
  まとめ対象期間になる。終了時刻まで含めたい場合は日付ではなく時刻まで書く
- ローカル D1 に投入する前に `vp run @animeishi/api#db:migrate:local` で
  `events` テーブルが作られていることを確認する

## 総選挙の投入と結果集計（elections:\*）

期間限定の投票企画「総選挙」（issue #438）を `elections` /
`election_candidates` テーブルに投入する。実体は
`apps/api/scripts/publish-election.mjs` で、特集記事・イベントと同じ
frontmatter 付き Markdown → slug upsert の仕組み。テーマ・候補の登録は
運営がこのスクリプトで行い、ユーザーの推しデータからの自動生成はしない
（issue #438 の決定）。

### Markdown ファイルの形式

選挙ファイルはリポジトリに入れず、投入する人の手元で管理する
（記事・イベントと同じ決定）。

```markdown
---
slug: megane-2026                     # 必須。[a-z0-9][a-z0-9-]*。総選挙詳細の URL になる
title: みんなが推す眼鏡キャラ総選挙      # 必須
starts_at: 2026-11-10T10:00:00+09:00  # 必須。投票受付の開始日時（ISO 8601）
ends_at: 2026-11-20T18:00:00+09:00    # 必須。投票受付の終了日時。starts_at より後
cover_image_url: https://...          # 省略可。一覧カードと詳細上部に出す画像
published_at: 2026-11-01T09:00:00+09:00    # 必須。アプリへの公開開始日時
unpublished_at: 2026-12-01T00:00:00+09:00  # 省略可。公開終了日時。省略時は終了期限なし
candidates:                           # 必須。候補リスト（2 件以上。並び順が表示順）
  - kind: character                   #   character（キャラ）| work（作品）
    annict_id: 1234                   #   Annict の ID（正の整数）
    name: 山田太郎                     #   表示名
    image_url: https://...            #   省略可。候補に出す画像
  - kind: work
    annict_id: 5678
    name: 作品タイトル
---

説明文 Markdown（省略可。お題の説明や注意点など。空なら詳細に本文を出さない）
```

- `starts_at`〜`ends_at` が投票受付期間、`published_at`〜`unpublished_at`
  がアプリへの公開期間。別々に指定できる（例: 公開は投票開始より早くして
  予告にする）
- 投票中の途中経過はユーザーに公開しない（API は得票数を返さない）。
  結果の公開は下の「結果の集計と記事化」を参照

### 実行

```sh
pnpm task elections:publish -- /path/to/election.md          # 本番（確認プロンプト付き）
pnpm task elections:publish:preview -- /path/to/election.md  # プレビュー
pnpm task elections:publish:local -- /path/to/election.md    # ローカル D1
```

- 同じ slug で再投入すると上書きされる（`created_at` は初回投入時のまま）。
  **frontmatter から消した候補は、その候補への票ごと削除される**
  （`election_votes.candidate_id` が `ON DELETE CASCADE`）。
  投票期間中に候補を消すときは特に注意
- 公開を止めたい総選挙は `unpublished_at` を過去日時にして再投入する
  （行の削除手段はない。公開期間外の総選挙は API が一覧・詳細ともに返さない）
- ローカル D1 に投入する前に `vp run @animeishi/api#db:migrate:local` で
  `elections` 系のテーブルが作られていることを確認する

### 結果の集計と記事化

投票期間（`ends_at`）が終わったら、運営が結果を集計して特集記事
（issue #437 の仕組み）として公開する。途中経過はユーザーに見せない
運用なので、終了前に集計結果を公開しない。

```sh
pnpm task elections:results -- megane-2026          # 本番
pnpm task elections:results:preview -- megane-2026  # プレビュー
pnpm task elections:results:local -- megane-2026    # ローカル D1
```

出力は「総選挙の情報と総得票数」→「候補ごとの得票数（多い順）」。
この結果を `articles:publish` の Markdown（結果まとめ記事＋シェア画像を
`cover_image_url` に指定）に書き、`pnpm task articles:publish` で
特集枠に出す。結果発表を自動生成する仕組みはない。
