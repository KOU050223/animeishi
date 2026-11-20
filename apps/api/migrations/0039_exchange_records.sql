-- 交換記録（issue #661）。「いつ・どこで・どのイベントで」名刺を
-- 交換したかを、本人の名刺帳にだけ残す履歴テーブル。
-- 再会履歴（issue #662）の土台でもあり、同じ相手に複数行を積める
-- （owner_id + friend_id の UNIQUE は付けない）。各行は 1 回の
-- 交換・再会・手動の「会った」を表し、source で経路を区別する。
--
-- met_at が会った日時（初回交換は friends.created_at と同時刻）、
-- place_name は端末で地名化した地名・施設名テキスト（座標は保存しない）、
-- event_slug + event_name は紐付けた登録イベントまたは自由入力名
-- （登録イベントを選んだ場合も当時の表示名を event_name に写す）。
-- card_snapshot_key は交換当時の名刺コピー（R2 キー。issue #662 で使う。
-- 本 Issue では列だけ用意し NULL のまま）。
--
-- 各行は owner の私的な記録で、相手・第三者には API から一切返さない。
-- フレンド解除・ブロック時は当事者間の記録を両方向ともアプリ側で削除
-- （私用メモ issue #659 と同方針）。退会時は cascade + deleteMyAccount
-- で消える。events 側が削除された場合は event_slug だけ NULL に残す
-- （event_name は残るため履歴は読める）。

CREATE TABLE `exchange_records` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `owner_id` text NOT NULL,
  `friend_id` text NOT NULL,
  `source` text,
  `met_at` integer NOT NULL,
  `place_name` text,
  `event_slug` text,
  `event_name` text,
  `card_snapshot_key` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`friend_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`event_slug`) REFERENCES `events`(`slug`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `exchange_records_owner_friend_idx` ON `exchange_records` (`owner_id`, `friend_id`);
--> statement-breakpoint
CREATE INDEX `exchange_records_owner_idx` ON `exchange_records` (`owner_id`);
--> statement-breakpoint
-- 既存のフレンドには初回交換の記録を補填する（機能導入前の相手にも
-- 場所・イベントを後から付けられるようにするため）。source は
-- friends.source をそのまま引き継ぎ、経路不明の既存行は NULL のまま
-- （friends.source の NULL と同じ扱い）。
INSERT INTO `exchange_records` (`owner_id`, `friend_id`, `source`, `met_at`, `created_at`, `updated_at`)
SELECT `user_id`, `friend_id`, `source`, `created_at`, `created_at`, `created_at`
FROM `friends`;
