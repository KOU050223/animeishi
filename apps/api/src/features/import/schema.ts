import { z } from "zod";

// インポート対象の 1 作品。クライアント（WebView 注入 / ブックマークレット）が
// マイページ HTML から抽出し、話数単位の履歴を作品単位に集約済みのものを受け取る。
// targetState はクライアントが決める（コンプリート → WATCHED、履歴のみ → WATCHING）。
const danimeMatchWorkSchema = z.object({
  // workId が取れないカードはクライアント側で `title:<タイトル>` の疑似キーを
  // 使うため、タイトル長 + プレフィックス分の余裕を持たせる。
  danimeWorkId: z.string().trim().min(1).max(512),
  title: z.string().trim().min(1).max(500),
  targetState: z.enum(["WATCHED", "WATCHING"]),
});

export const danimeMatchRequestSchema = z.object({
  // 上限は異常なペイロードを弾くための頭打ち。issue #219 で発覚した
  // 500 件照合の CPU 爆発はスコアリングの前計算化（danime-core）で解決済み
  // なので、旧クライアント互換のため上限は従来の 500 を維持する。
  // 新しいクライアントは余裕を持って 100 件ずつ分割送信する
  // （mobile useDanimeImport）。
  works: z
    .array(danimeMatchWorkSchema)
    .min(1)
    .max(500, "一度に照合できるのは500作品までです"),
  // ユーザーの Annict ライブラリに登録済みの annictWorkId（任意）。
  // 入力タイトルが期数を明示しているとき「登録済みの別シーズン」を候補から
  // 外すためのヒントに使う。照合の絞り込み用途のみで、登録処理には使わない。
  registeredWorkIds: z.array(z.number().int().positive()).max(5000).optional(),
});

// --- 話単位の記録ジョブ（issue #477） ---
//
// クライアントが送るのは「作品照合で exact 確定した作品」と
// 「その作品ページから抽出した dアニメ話一覧」。Annict 話 ID の対応付けは
// サーバー（Workflow）側で Annict 話一覧と突き合わせて行うので、
// クライアントは任意の話 ID を直接指定できない。
const danimeEpisodeJobEpisodeSchema = z.object({
  partId: z.string().trim().min(1).max(64),
  watched: z.boolean(),
  label: z.string().max(200),
  subtitle: z.string().max(500),
});

const danimeEpisodeJobWorkSchema = z.object({
  danimeWorkId: z.string().trim().min(1).max(512),
  annictWorkId: z.number().int().positive(),
  episodes: z.array(danimeEpisodeJobEpisodeSchema).max(2000),
});

export const danimeEpisodeJobCreateSchema = z.object({
  // 作品単位の取り込み上限（danimeMatchRequestSchema.works と同程度）。
  works: z.array(danimeEpisodeJobWorkSchema).min(1).max(1000),
});
