# D1 マイグレーションの作り方

`migrations/` には 2 種類のものがある。

- `NNNN_<名前>.sql`: wrangler が `d1_migrations` テーブルのファイル名で適用を管理する。
  本番・プレビューへの適用は deploy/preview ワークフローが自動で行う
- `meta/`（`_journal.json` と `NNNN_snapshot.json`）: drizzle-kit が `db:generate` の
  差分計算に使う「現在のスキーマ」。wrangler は読まない

両方を正しく保つため、**`.sql` を手で新規追加してはいけない**。必ず drizzle-kit の
`generate` 経由で作る。`.sql` だけ足すと `meta/` がずれ、`db:generate` が過去の
マイグレーションまで遡った差分を出すようになる（issue #807 で修復した）。

## スキーマ変更（schema.db.ts の変更に対応する DDL）

```bash
# features/<domain>/schema.db.ts を変更してから
vp run @animeishi/api#db:generate
```

`NNNN_<自動名>.sql`、journal エントリ、新しいスナップショットが一緒に生成される。
生成された SQL はレビューして、必要なら本文を手直ししてよい
（partial index やコメントの追記など）。journal・スナップショットは手で編集しない。
ファイル名を意味のあるものにしたいときは `drizzle-kit generate --name <名前>` で生成する
（main に入った後の改名は `d1_migrations` の適用記録とずれるため不可）。

## 手書きが必要な変更（データ移行・generate が出せない DDL）

```bash
vp -C apps/api exec drizzle-kit generate --custom --name <名前>
```

`--custom` は空の `.sql` と journal・スナップショットだけを生成する。これに SQL を
手で書く。スキーマ変更を伴う場合は先に `schema.db.ts` を更新してから実行し、
スナップショットが変更後のスキーマを指すようにする。スキーマ変更を伴わない純粋な
データ移行でもこの手順で作る（meta を同期させるため）。

> 手書きマイグレーションが多い実態に合わせてこの運用にしている。
> 0000 からの適用で `db:generate` が「差分なし」になる状態を維持することが目的。

## 確認

- 変更後に `vp run @animeishi/api#db:generate` をもう一度実行し、
  `No schema changes, nothing to migrate` になることを確認する。
  差分が出たらスキーマとマイグレーションの結果がずれている
- `drizzle-kit generate` は差分があると「新規テーブルか改名か」の対話プロンプトを
  出すことがある。非対話環境では `--name` やスキーマ側の整理で回避する

## `meta/` がずれたときの直し方

`db:generate` が実際のスキーマ変更と関係ない差分を出すときに行う。

1. ローカル D1 を作り直して全マイグレーションを適用する
   （`.wrangler/state/v3/d1` を消して `vp run @animeishi/api#db:migrate:local`）
2. スキーマから見た現在状態を取得する。`drizzle-kit introspect` は CHECK 制約の
   割当て・partial index の WHERE が壊れて取れるため使わず、
   `drizzle-kit generate`（空の `out` ディレクトリを指す一時 config）が書き出す
   スナップショットを使う
3. そのスナップショットを `meta/NNNN_snapshot.json`（NNNN = 最新マイグレーション番号）
   として置き、`_journal.json` に全マイグレーション分のエントリを揃える
   （`when` は初回コミット時刻、`breakpoints` はファイルの `--> statement-breakpoint`
   有無で揃える）
4. `vp run @animeishi/api#db:generate` で `No schema changes` になることを確認する

実施例は issue #807 の対応 PR。
