-- AI おすすめ生成（issue #335）
--
-- analyses（issue #22）と同じ考え方で、user_id 1 行に「最新の生成結果」と
-- 「生成回数カウンタ」を同居させる。POST /me/analysis/recommendations は
-- 入力（視聴履歴＋選択ジャンル）のハッシュが変わらない限り 24h キャッシュを
-- 返し、変わっていれば Workers AI＋Annict searchWorks で生成する。
-- 呼び出しは固定窓（24h）あたりの generation_count で制限する。
--
-- works_json / input_hash / generated_at は生成が完了するまで NULL
-- （レート制限の claim が行だけ先行作成するため）。
CREATE TABLE `recommendations` (
  `user_id` text PRIMARY KEY NOT NULL,
  `works_json` text,
  `input_hash` text,
  `generated_at` integer,
  `window_started_at` integer NOT NULL,
  `generation_count` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
