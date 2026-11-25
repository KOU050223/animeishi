import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { users } from "#src/features/users/schema.db";

// ---- annict_tokens (Web 連携用の暗号化トークン保存) ----
// Web(ブラウザ)連携では SecureStore が無く localStorage は XSS リスクがあるため、
// Annict アクセストークンを AES-GCM で暗号化して D1 に保存し、HttpOnly Cookie の
// セッションから参照する（詳細は docs/05 追補）。ネイティブは従来のヘッダ方式で
// このテーブルは使わない。userId(Clerk) 単位で 1 トークンを持つ。
export const annictTokens = sqliteTable("annict_tokens", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // encryptToken() が返す base64(iv||ciphertext)。平文は保存しない。
  encryptedToken: text("encrypted_token").notNull(),
  // Annict 側のトークン所有者 ID（表示・突き合わせ用）。
  annictUserId: integer("annict_user_id"),
  scope: text("scope"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export type AnnictToken = typeof annictTokens.$inferSelect;
