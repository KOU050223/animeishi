import { z } from "zod";

// シーズン識別子。annict_works.seasonName と同じ "<年4桁>-<season>" 形式。
// worksSearchQuerySchema.season と同じ制約だが、あちらは optional なので共有せず
// 単体のスキーマとして切り出して両方から使う。
export const seasonSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-(winter|spring|summer|autumn)$/,
    "シーズンの形式が正しくありません",
  );

// tier 表の 1 行（S / A / B ...）。key は items.tierKey から参照される識別子で、
// ラベル・色はユーザーが自由に変えられるため key とは別に持つ。
// キャラクター tier 表（features/character-tier-lists）も同じ行構造を使う。
export const tierRowSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "tier のキーが必要です")
    .max(32, "tier のキーが長すぎます"),
  label: z
    .string()
    .trim()
    .min(1, "tier のラベルを入力してください")
    .max(24, "tier のラベルは24文字以内で入力してください"),
  // #RRGGBB 形式。クライアントのカラーピッカーが生成する形式に合わせる。
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "色の形式が正しくありません"),
});

const tierListItemSchema = z.object({
  annictWorkId: z.number().int().positive(),
  tierKey: z.string().trim().min(1),
});

export const tierListSaveSchema = z
  .object({
    season: seasonSchema,
    title: z
      .string()
      .trim()
      .min(1, "タイトルを入力してください")
      .max(50, "タイトルは50文字以内で入力してください"),
    tiers: z
      .array(tierRowSchema)
      .min(1, "tier を1つ以上設定してください")
      .max(12, "tier は12個までです")
      .refine(
        (rows) => new Set(rows.map((r) => r.key)).size === rows.length,
        "tier のキーが重複しています",
      ),
    // position はサーバが配列順から採番する。クライアントが送ってきた値は使わない
    // （順序の正が配列順とカラムの2か所に分かれると必ずズレるため）。
    items: z.array(tierListItemSchema).max(500, "作品数が多すぎます"),
  })
  // items.tierKey が tiers に存在しない = どの行にも描画されない幽霊配置になる。
  // FK が張れない参照なのでここで弾く。
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

export type TierRowInput = z.infer<typeof tierRowSchema>;
export type TierListSaveInput = z.infer<typeof tierListSaveSchema>;

export const tierListSeasonParamSchema = z.object({ season: seasonSchema });
