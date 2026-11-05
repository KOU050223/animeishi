import { z } from "zod";
import { tierRowSchema } from "../tier-lists/schema";

// 自由作成 tier 表の保存入力。シーズン版（tierListSaveSchema）と違い
// スコープキー（season）を持たず、タイトルはユーザーが付けるテーマ名。
const customTierListItemSchema = z.object({
  annictWorkId: z.number().int().positive(),
  tierKey: z.string().trim().min(1),
});

export const customTierListSaveSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "タイトルを入力してください")
      .max(50, "タイトルは50文字以内で入力してください"),
    // 表の説明文（issue #476）。上限は作品リストと同じ 500 文字。
    description: z
      .string()
      .trim()
      .max(500, "説明は500文字以内で入力してください")
      .nullish(),
    // ひろばの公開一覧に載るか（issue #476）。description / isPublic は
    // どちらも省略時は新規作成=既定値、更新=既存値を維持する
    // （未対応のクライアントが全置換 PUT で設定を潰さないようにするため）。
    isPublic: z.boolean().optional(),
    tiers: z
      .array(tierRowSchema)
      .min(1, "tier を1つ以上設定してください")
      .max(12, "tier は12個までです")
      .refine(
        (rows) => new Set(rows.map((r) => r.key)).size === rows.length,
        "tier のキーが重複しています",
      ),
    // position はサーバが配列順から採番する。クライアントが送ってきた値は
    // 使わない（シーズン版と同じ理由）。
    items: z.array(customTierListItemSchema).max(500, "作品数が多すぎます"),
  })
  // items.tierKey が tiers に存在しない = どの行にも描画されない幽霊配置に
  // なる。FK が張れない参照なのでここで弾く。
  .refine(
    (v) => {
      const keys = new Set(v.tiers.map((t) => t.key));
      return v.items.every((item) => keys.has(item.tierKey));
    },
    { error: "存在しない tier が指定されています", path: ["items"] },
  )
  .refine(
    (v) => new Set(v.items.map((i) => i.annictWorkId)).size === v.items.length,
    { error: "同じ作品が複数の tier に配置されています", path: ["items"] },
  );

export type CustomTierListSaveInput = z.infer<typeof customTierListSaveSchema>;

// /me/custom-tier-lists/:id 系パスのパラメータ。パスパラメータは文字列なので coerce。
export const customTierListIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
