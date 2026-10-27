import { z } from "zod";

// インポート対象の 1 作品。クライアント（WebView 注入 / ブックマークレット）が
// マイページ HTML から抽出し、話数単位の履歴を作品単位に集約済みのものを受け取る。
// targetState はクライアントが決める（コンプリート → WATCHED、履歴のみ → WATCHING）。
export const danimeMatchWorkSchema = z.object({
  // workId が取れないカードはクライアント側で `title:<タイトル>` の疑似キーを
  // 使うため、タイトル長 + プレフィックス分の余裕を持たせる。
  danimeWorkId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(500),
  targetState: z.enum(["WATCHED", "WATCHING"]),
});

export const danimeMatchRequestSchema = z.object({
  // 上限は 1 リクエストあたりの Annict 往復数・CPU 時間を頭打ちにするための
  // もの（issue #219: 500 件の一括照合で Workers の CPU 上限を超え 503 化）。
  // クライアントはこの件数で分割送信する（mobile useDanimeImport）。
  works: z
    .array(danimeMatchWorkSchema)
    .min(1)
    .max(100, "一度に照合できるのは100作品までです"),
  // ユーザーの Annict ライブラリに登録済みの annictWorkId（任意）。
  // 入力タイトルが期数を明示しているとき「登録済みの別シーズン」を候補から
  // 外すためのヒントに使う。照合の絞り込み用途のみで、登録処理には使わない。
  registeredWorkIds: z.array(z.number().int().positive()).max(5000).optional(),
});

export type DanimeMatchRequestInput = z.infer<typeof danimeMatchRequestSchema>;
