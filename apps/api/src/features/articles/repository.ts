import { and, desc, eq, gt, isNull, lte, or } from "drizzle-orm";
import type { DrizzleDb } from "@/db/client";
import { articles } from "@/db/schema";
import type { Article } from "@/db/schema";

/**
 * articlesRepository: 特集記事（issue #437）の読み取り専用リポジトリ。
 * 記事の投入・更新は scripts/publish-article.mjs（Taskfile 経由）が行い、
 * API 経路では書き込まない。ユーザー固有のデータを持たないため、
 * 他 feature と違い userId は束縛しない。
 */
export function articlesRepository(db: DrizzleDb) {
  // 公開中 = published_at <= now かつ（unpublished_at が NULL か now より後）
  const publishedNow = (now: Date) =>
    and(
      lte(articles.publishedAt, now),
      or(isNull(articles.unpublishedAt), gt(articles.unpublishedAt, now)),
    );

  return {
    /** 公開中の記事を公開開始の新しい順に limit 件返す。 */
    async listPublished(opts: { now: Date; limit: number }) {
      return db
        .select({
          slug: articles.slug,
          title: articles.title,
          coverImageUrl: articles.coverImageUrl,
          publishedAt: articles.publishedAt,
        })
        .from(articles)
        .where(publishedNow(opts.now))
        .orderBy(desc(articles.publishedAt))
        .limit(opts.limit);
    },

    /**
     * 公開中の記事を slug で 1 件返す。存在しない・公開期間外は undefined
     * （公開前の記事の存在を応答で区別しない）。
     */
    async getPublished(opts: {
      slug: string;
      now: Date;
    }): Promise<Article | undefined> {
      return db.query.articles.findFirst({
        where: and(eq(articles.slug, opts.slug), publishedNow(opts.now)),
      });
    },
  };
}

export type ArticlesRepository = ReturnType<typeof articlesRepository>;
