import { z } from "zod";
import { WORK_RATINGS } from "@/db/schema";

// PUT /me/work-ratings/:annictWorkId のボディ。3 段階
// （bad=イマイチ / good=良い / great=最高。issue #416）。
export const workRatingUpsertSchema = z.object({
  rating: z.enum(WORK_RATINGS, {
    error: () => "有効な評価を選択してください",
  }),
});

export type WorkRatingUpsertInput = z.infer<typeof workRatingUpsertSchema>;
