import { z } from "zod";

// 作品検索（GET /works/search）のクエリパラメータ。
// title は Annict searchWorks に渡す検索語。省略時はサーバーが「今期シーズン」を
// 既定にして初期表示（今期アニメ）を返す。season を明示すると任意シーズンを引ける。
// after はカーソルページング用。
export const worksSearchQuerySchema = z.object({
  // title は任意。省略・空文字（?title=）はどちらも「未指定」とみなし、route 側で
  // trim して空ならシーズン検索へフォールバックする。ここで min(1) を課さないのは、
  // 空文字を 400 にせず今期シーズン検索に流すため。
  title: z.string().trim().optional(),
  // 例: "2026-spring"。<年4桁>-<winter|spring|summer|autumn>。
  // 年のみ（"2026"）も可。その場合はその年の 4 クール分に展開して引く
  // （放送年での絞り込み。issue #346）。
  season: z
    .string()
    .trim()
    .regex(
      /^\d{4}(-(winter|spring|summer|autumn))?$/,
      "シーズンの形式が正しくありません",
    )
    .optional(),
  after: z.string().trim().min(1).optional(),
});

export type WorksSearchQueryInput = z.infer<typeof worksSearchQuerySchema>;

// /works/:annictWorkId 系パスのパラメータ。パスパラメータは文字列なので coerce。
export const annictWorkIdParamSchema = z.object({
  annictWorkId: z.coerce.number().int().positive(),
});

// 作品 ID まとめ解決（GET /works/lookup）のクエリパラメータ。
// 自由作成 tier 表（issue #348）の作成画面が、#349（作品リスト）から引き継いだ
// 初期作品 ID のメタを解決するために使う。1 リクエスト 50 件まで
// （Annict searchWorks の 1 ページ上限に合わせる）。
export const worksLookupQuerySchema = z.object({
  ids: z
    .string()
    .min(1)
    .transform((raw) => raw.split(",").map(Number))
    .pipe(
      z
        .array(z.number().int().positive())
        .min(1)
        .max(50, "ids は 50 件までです"),
    ),
});
