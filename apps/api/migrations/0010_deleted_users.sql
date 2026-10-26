-- アカウント削除済みユーザーの tombstone（issue #144）
--
-- DELETE /me で users 行と Clerk ユーザーを削除しても、発行済み JWT が
-- 有効な間は ensureUserExists / upsertMyProfile が users 行を再作成し、
-- 公開プロフィールが残りうる。削除時に user_id を記録しておき、
-- 認証ミドルウェアと users への INSERT で拒否する。
--
-- users への FK は張らない（users 行が存在しない状態で書くため）。

CREATE TABLE `deleted_users` (
  `user_id` text PRIMARY KEY NOT NULL,
  `deleted_at` integer NOT NULL
);
