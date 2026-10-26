-- Web(ブラウザ)での Annict 連携用に、暗号化したアクセストークンを保存する。
-- ネイティブは SecureStore + X-Annict-Token ヘッダ方式のままで、このテーブルは
-- Web の HttpOnly Cookie セッションからのみ参照される（詳細は docs/05 追補）。
--
-- トークンは AES-GCM で暗号化した base64(iv||ciphertext) を encrypted_token に保存し、
-- 平文は保存しない。userId(Clerk) 単位で 1 トークン。users 削除時に連鎖削除する。

CREATE TABLE `annict_tokens` (
  `user_id` text PRIMARY KEY NOT NULL,
  `encrypted_token` text NOT NULL,
  `annict_user_id` integer,
  `scope` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
