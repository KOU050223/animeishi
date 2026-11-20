-- 名刺帳の私用メモ（issue #659）
--
-- フレンド（= 交換した名刺の相手）ごとに、本人にだけ見える自由記述の
-- メモを持つ。「この人どうだったっけ」を残す名刺帳の要素で、
-- 相手・第三者には API から一切返さない。
-- フレンド解除・ブロック時は両方向のメモをアプリ側で削除する
-- （解除で消す方針）。退会時は cascade + deleteMyAccount で消える。

CREATE TABLE `friend_notes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `owner_id` text NOT NULL,
  `friend_id` text NOT NULL,
  `body` text NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`friend_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `friend_notes_owner_friend_unique` ON `friend_notes` (`owner_id`, `friend_id`);
--> statement-breakpoint
CREATE INDEX `friend_notes_owner_idx` ON `friend_notes` (`owner_id`);
