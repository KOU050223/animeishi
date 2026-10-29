-- 視聴履歴の「視聴者数順」ソート（issue #345）に使う Annict の
-- watchersCount（作品の人気指標）を annict_works に保持する。
--
-- read-through（GET /me/watch-histories）の libraryEntries 同期で取得・
-- upsert する。既存行はすべて NULL で、次回のライブラリ同期から順次埋まる。
-- NULL は「未取得」を表し、0（視聴者ゼロ）とは区別する。

ALTER TABLE `annict_works` ADD COLUMN `watchers_count` integer;
