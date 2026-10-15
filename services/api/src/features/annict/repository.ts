import { eq } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { annictTokens } from "@/db/schema";
import type { AnnictToken } from "@/db/schema";

/**
 * annictRepository: 認証済みユーザーIDを束縛した annict_tokens の
 * リポジトリ層（旧 repository/authorizedDb.ts の Annict Token セクション）。
 * Web(ブラウザ)連携でのみ使う。ネイティブはヘッダ方式でこのテーブルを触らない。
 */
export function annictRepository(db: DrizzleDb, currentUserId: string) {
  return {
    /** 保存済みの暗号化トークン行を取得する。未連携なら undefined。 */
    async getAnnictTokenRow(): Promise<AnnictToken | undefined> {
      return db.query.annictTokens.findFirst({
        where: eq(annictTokens.userId, currentUserId),
      });
    },

    /** 暗号化済みトークンを保存（upsert）する。再連携時は上書きする。 */
    async upsertAnnictToken(data: {
      encryptedToken: string;
      annictUserId: number | null;
      scope: string | null;
    }): Promise<void> {
      const now = new Date();
      await db
        .insert(annictTokens)
        .values({
          userId: currentUserId,
          encryptedToken: data.encryptedToken,
          annictUserId: data.annictUserId,
          scope: data.scope,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: annictTokens.userId,
          set: {
            encryptedToken: data.encryptedToken,
            annictUserId: data.annictUserId,
            scope: data.scope,
            updatedAt: now,
          },
        });
    },

    /** 保存済みトークンを削除する（連携解除）。 */
    async deleteAnnictToken(): Promise<void> {
      await db
        .delete(annictTokens)
        .where(eq(annictTokens.userId, currentUserId));
    },
  };
}

export type AnnictRepository = ReturnType<typeof annictRepository>;
