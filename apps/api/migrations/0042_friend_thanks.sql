-- 名刺交換後のお礼（issue #694）
--
-- チャットではなく、交換した相手へ「定型文 1 つ＋任意の 1 行」
-- （60 文字まで・改行不可、未入力なら body は NULL）を送る一方通行の
-- お礼テーブル。preset_key は表示文言ではなくキーで保存し、表示側が
-- 受け手の言語（ja / en）で翻訳する。同じ相手への送信は日本時間の
-- 暦日で 1 日 1 通まで（アプリ側で NOT EXISTS 挿入。#662 の同日判定と
-- 同じ JST 基準）。read_at は受け手が開いた時刻で、受け手側の未読
-- 表示にだけ使い送り手には返さない。deleted_at は送り手の取り消し
-- （論理削除、0043 で追加）。
--
-- 各行は送り手・受け手の当事者にだけ見え、それ以外には API から一切
-- 返さない。フレンド解除・ブロック時は当事者間のお礼を両方向とも
-- アプリ側で削除（friend_notes issue #659 / exchange_records
-- issue #661 と同方針）。退会時は cascade + deleteMyAccount で消える。

CREATE TABLE `friend_thanks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `sender_id` text NOT NULL,
  `recipient_id` text NOT NULL,
  `preset_key` text NOT NULL,
  `body` text,
  `created_at` integer NOT NULL,
  `read_at` integer,
  FOREIGN KEY (`sender_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `friend_thanks_recipient_idx` ON `friend_thanks` (`recipient_id`);
--> statement-breakpoint
CREATE INDEX `friend_thanks_sender_recipient_idx` ON `friend_thanks` (`sender_id`, `recipient_id`);
