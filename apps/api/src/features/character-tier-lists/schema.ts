import { z } from "zod";
import { tierRowSchema } from "../tier-lists/schema";

// キャラクター tier 表（issue #169）
//
// 作品 tier 表（season 単位）に対し、キャラクター tier 表は「作品 1 つ」を
// スコープにするため annictWorkId で識別する。行定義（tiers）の構造は
// 作品版と同じで、items の参照先が annictWorkId → annictCharacterId に
// 変わるだけ。

const characterTierListItemSchema = z.object({
  annictCharacterId: z.number().int().positive(),
  tierKey: z.string().trim().min(1),
});

export const characterTierListSaveSchema = z
  .object({
    annictWorkId: z.number().int().positive(),
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
    items: z
      .array(characterTierListItemSchema)
      .max(500, "キャラクター数が多すぎます"),
  })
  .refine(
    (v) => {
      const keys = new Set(v.tiers.map((t) => t.key));
      return v.items.every((item) => keys.has(item.tierKey));
    },
    { error: "存在しない tier が指定されています", path: ["items"] },
  )
  .refine(
    (v) =>
      new Set(v.items.map((i) => i.annictCharacterId)).size === v.items.length,
    {
      error: "同じキャラクターが複数の tier に配置されています",
      path: ["items"],
    },
  );

export type CharacterTierListSaveInput = z.infer<
  typeof characterTierListSaveSchema
>;
