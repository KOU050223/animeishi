-- Annict updateStatus(input.workId) は GraphQL の Work Node ID（ID! 型）を要求する。
-- annict_works.annict_work_id は annictId(Int) で Node ID とは別物のため、
-- read-through 時に取得した Node ID を保持するカラムを追加する。
--
-- 既存行は null（未取得）。更新時に Node ID が必要になった作品は searchWorks で
-- 解決して埋める。read-through（GET /me/watch-histories）でも順次埋まる。

ALTER TABLE `annict_works` ADD COLUMN `node_id` text;
