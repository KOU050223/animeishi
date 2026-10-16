-- Workers AI 視聴傾向分析（issue #22）
--
-- user_id 1 行に「最新の分析結果」と「生成回数カウンタ」を同居させる。
-- POST /me/analysis は入力（視聴履歴＋選択ジャンル）のハッシュが変わらない
-- 限り 24h キャッシュを返し、変わっていれば Workers AI を呼ぶ。呼び出しは
-- 固定窓（24h）あたりの generation_count で制限する。
--
-- summary / genres_json / input_hash / work_count / generated_at は生成が
-- 完了するまで NULL（レート制限の claim が行だけ先行作成するため）。
CREATE TABLE `analyses` (
  `user_id` text PRIMARY KEY NOT NULL,
  `summary` text,
  `genres_json` text,
  `input_hash` text,
  `work_count` integer,
  `generated_at` integer,
  `window_started_at` integer NOT NULL,
  `generation_count` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
