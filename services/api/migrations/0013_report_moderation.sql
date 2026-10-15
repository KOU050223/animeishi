-- 通報のモデレーション対応状況（issue #186）
--
-- 通報はこれまで Sentry Alert → Discord 通知のみで、対応済みかどうかの
-- 管理がなかった。reports に対応ステータス・対応メモ・対応日時を追加し、
-- scripts/reports.sh（wrangler d1 execute ベース）で棚卸し・状態更新する。
-- 管理画面・管理者 API は認可設計が未決のため今回は作らない。
--
-- status: open（未対応）/ resolved（対応済み）/ dismissed（却下・対応不要）
-- 既存行はすべて未対応として扱うため DEFAULT 'open' で揃える。

ALTER TABLE `reports` ADD COLUMN `status` text DEFAULT 'open' NOT NULL CONSTRAINT `reports_status_check` CHECK (`status` IN ('open', 'resolved', 'dismissed'));
--> statement-breakpoint
ALTER TABLE `reports` ADD COLUMN `resolution_note` text;
--> statement-breakpoint
ALTER TABLE `reports` ADD COLUMN `resolved_at` integer;
--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`);
