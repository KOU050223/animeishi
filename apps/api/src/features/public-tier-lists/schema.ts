import { z } from "zod";
import { TIER_LIST_KINDS } from "@/db/schema";

// ひろば「みつける」の公開 Tier 表一覧のクエリ（issue #418）。
// 3 種類（season / character / custom）を 1 つのフィードに混ぜて返す。
//
// cursor は "<ソートキー>_<kind 順位>_<id>"（likes はいいね数・new は
// created_at の unix 秒。kind 順位は season=0, character=1, custom=2 で
// 降順のタイブレークに使う）。数値 3 連結で正規表現する。
export const publicTierListsQuerySchema = z.object({
  sort: z.enum(["likes", "new"]).optional(),
  cursor: z
    .string()
    .regex(/^\d+_\d+_\d+$/)
    .optional(),
  limit: z
    .string()
    .regex(/^[1-9]\d*$/)
    .optional(),
});

// 詳細・いいね・通報のパスパラメータ。kind で参照先テーブルを振り分ける。
export const publicTierListParamSchema = z.object({
  kind: z.enum(TIER_LIST_KINDS),
  id: z.coerce.number().int().positive(),
});

// 通報理由のバリデーション（reportCreateSchema / workListReportSchema と同じ）。
// フロントの選択肢は REPORT_REASONS（useModeration.ts）に合わせる。
export const tierListReportSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
