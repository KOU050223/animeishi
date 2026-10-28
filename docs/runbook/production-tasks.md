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
* images:takedown:        本番の作品画像を削除し、以後の補完を止める（MAL の削除依頼対応。確認プロンプト付き）
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

1. 作品 ID を `--` 以降に並べる（例: `pnpm task images:takedown -- 123 456`）か、
   `pnpm task images:takedown -- --all-mal` で MAL 由来の全件を対象にする
2. 件数と一覧を表示してから確認プロンプトが出る。承認すると、対象を `image_source='blocked'`・
   `resolved_image_url` NULL にしてから、R2 のオブジェクトを消して `image_r2_key` を NULL にする
3. R2 から消せなかったキーは DB に残るので、表示された作品 ID で再実行する

`'blocked'` の作品は cron・画像プロキシ・検索のどこからも補完し直さない
（Annict の元の画像は MAL 由来ではないので、プロキシは引き続き配信する）。

プロキシ前段のキャッシュは消せないが、MAL 由来の画像は Cache-Control を
合計 12 時間以下にしてあるので、実行後 12 時間以内に切れる。
ただし短縮前（issue #241 のデプロイ前）に入ったキャッシュは 1 日 +
`stale-while-revalidate` 7 日のままなので、デプロイから 8 日間は 24 時間以内に
切れる保証がない。その間に削除依頼が来たら、Cloudflare ダッシュボードの
Purge Cache（Custom Purge の URL 指定）で `https://<API ドメイン>/images/works/<id>` も消す。

使い方は `bash apps/api/scripts/takedown-work-images.sh --help`。プレビューは
`--env preview`、ローカル（wrangler dev の D1・R2）は `--local` を直接付けて叩く。
