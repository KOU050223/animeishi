import { z } from "zod";

// POST /users/:id/report のボディ。reason はプリセット理由ラベル or 自由入力を
// そのまま受ける（UGC モデレーション用の通報理由）。
export const reportCreateSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "通報理由を入力してください")
    .max(500, "通報理由は500文字以内で入力してください"),
});

export type ReportCreateInput = z.infer<typeof reportCreateSchema>;
