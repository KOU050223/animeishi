import { z } from "zod";

// オリジナル作品リストの保存入力。custom_tier_lists（issue #348）と違い
// tier 配置を持たず、説明文を持つ。position はサーバが配列順から採番する
// （クライアントの申告値は使わない。custom_tier_lists と同じ理由）。
const workListItemSchema = z.object({
  annictWorkId: z.number().int().positive(),
});

export const workListSaveSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "タイトルを入力してください")
      .max(50, "タイトルは50文字以内で入力してください"),
    description: z
      .string()
      .trim()
      .max(500, "説明は500文字以内で入力してください")
      .nullish(),
    // ひろばの公開一覧に載るか（issue #422）。省略時は新規作成=非公開、
    // 更新=既存値を維持する（isPublic 未対応のクライアントが全置換 PUT で
    // 公開設定を潰さないようにするため）。
    isPublic: z.boolean().optional(),
    items: z.array(workListItemSchema).max(500, "作品数が多すぎます"),
  })
  .refine(
    (v) => new Set(v.items.map((i) => i.annictWorkId)).size === v.items.length,
    { error: "同じ作品が複数登録されています", path: ["items"] },
  );

export type WorkListSaveInput = z.infer<typeof workListSaveSchema>;

// /me/work-lists/:id 系パスのパラメータ。パスパラメータは文字列なので coerce。
export const workListIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

// GET /me/work-lists のクエリ。contains を指定すると各行に、その作品が
// リストに入っているかのフラグ（containsWork）を付ける（issue #377 の
// 「リストに追加」シートが追加済み表示に使う）。
export const workListsQuerySchema = z.object({
  contains: z.coerce.number().int().positive().optional(),
});

// POST /me/work-lists/:id/items の入力。末尾への 1 件追加。
export const workListItemAddSchema = z.object({
  annictWorkId: z.number().int().positive(),
});

// GET /work-lists/public のクエリ（issue #422）。
// sort: "likes"（いいね数順）/ "new"（新着順）。省略時は likes。
// cursor: 前ページ最後尾のキー。new ではリスト id、likes では
// 「いいね数_id」の複合キー（いいね数は単調増加しないため
// id だけだと順位が動いて重複・抜けが出る）。
export const publicWorkListsQuerySchema = z.object({
  sort: z.enum(["likes", "new"]).optional(),
  cursor: z
    .string()
    .regex(/^\d+(_\d+)?$/, "cursor の形式が正しくありません")
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/, "limit は 1 以上の整数で指定してください")
    .optional(),
});

// POST /work-lists/:id/report のボディ。ユーザー通報（features/users）と
// 同じくプリセット理由ラベル or 自由入力をそのまま受ける。
export const workListReportSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "通報理由を入力してください")
    .max(500, "通報理由は500文字以内で入力してください"),
});
