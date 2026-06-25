# Cron バッチ（アニメデータ同期 & Cache Purge）

Cloudflare Workers の `scheduled` ハンドラで動く定期バッチ。
外部ソース（しょぼいカレンダー）からアニメデータを取得して D1 へ upsert し、
変更があれば Cloudflare のキャッシュをパージする。

## 構成

| ファイル         | 役割                                                              |
| ---------------- | ----------------------------------------------------------------- |
| `index.ts`       | `scheduled` の本体。cron 式で `anime-sync` / `season-sync` に分岐 |
| `anime-sync.ts`  | 全アニメデータの同期バッチ                                        |
| `season-sync.ts` | 現在シーズンのみを更新する軽量バッチ                              |
| `source.ts`      | 取得元の抽象化（`fetchFromShobocal`）。テストではモックを注入     |
| `cache.ts`       | Cloudflare ゾーン + Worker Cache API のパージ                     |

DB 書き込みは `src/repository/animeSyncRepo.ts`（リポジトリ層）に閉じている
（ESLint `no-direct-db` ルール）。

## スケジュール（`wrangler.toml` の `[triggers]`）

| cron 式       | バッチ      | 頻度                          |
| ------------- | ----------- | ----------------------------- |
| `0 18 * * *`  | anime-sync  | 毎日 18:00 UTC（JST 翌 3:00） |
| `0 */6 * * *` | season-sync | 6 時間ごと                    |

## Cache Purge

変更（insert / update）が 1 件以上あった場合のみ実行する。

1. **Cloudflare ゾーンのエッジキャッシュ**: REST API `purge_cache`（`purge_everything`）。
   `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ZONE_ID` が未設定なら自動スキップ（ローカル安全）。
2. **Worker Cache API**: `/titles` ルートが保存したレスポンス（`TITLES_CACHE_KEY`）を削除。

### 必要なシークレット（本番）

```bash
wrangler secret put CLOUDFLARE_API_TOKEN   # Zone.Cache Purge 権限
wrangler secret put CLOUDFLARE_ZONE_ID
```

## ローカルでの手動トリガー

```bash
task dev:api:scheduled       # = wrangler dev --test-scheduled
```

起動後、別端末から:

```bash
# 全件同期
curl "http://localhost:8787/__scheduled?cron=0+18+*+*+*"
# シーズン同期
curl "http://localhost:8787/__scheduled?cron=0+*/6+*+*+*"
```

実行後に D1 のデータが更新されることを確認できる。
