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
  season: z
    .string()
    .trim()
    .regex(
      /^\d{4}-(winter|spring|summer|autumn)$/,
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
