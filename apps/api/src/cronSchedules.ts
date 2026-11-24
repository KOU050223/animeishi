// ジャンル・タグの取り込み（issue #346）だけを回す cron。wrangler.toml の
// [env.production.triggers] の crons と同じ文字列にする（違うと一度も回らない）。
// mal_id_search・image_fallback と同じ実行に載せると、1 実行あたりの
// サブリクエスト・D1 クエリ数の上限を先行ジョブと分け合う。最後に回る
// genre_fetch の D1 照会だけが internal error で落ち続けたため、実行を分けた
// （issue #783）。
export const GENRE_FETCH_CRON = "15,45 * * * *";
