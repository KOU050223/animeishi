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
* images:backfill:        本番の未取り込み作品画像を画像プロキシ経由で一括取り込み
* images:takedown:        本番の作品画像を削除し、以後の補完を止める（MAL の削除依頼対応。プロキシのキャッシュも Purge。確認プロンプト付き）
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
