import { z } from "zod";

// /me/episode-records/:annictEpisodeId 系パスのパラメータ。
// パスパラメータは文字列なので coerce。
export const annictEpisodeIdParamSchema = z.object({
  annictEpisodeId: z.coerce.number().int().positive(),
});
