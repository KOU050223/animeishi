import { z } from "zod";

const INAPPROPRIATE_PATTERNS = [/死ね|殺す|バカ|アホ/, /https?:\/\/[^\s]+/];

const commentSchema = z
  .string()
  .trim()
  .max(500, "コメントは500文字以内で入力してください")
  .refine(
    (v) => !INAPPROPRIATE_PATTERNS.some((p) => p.test(v)),
    "不適切な内容が含まれています",
  )
  .optional();

const RESERVED_WORDS = ["admin", "root", "test", "system", "null", "undefined"];

const usernameSchema = z
  .string()
  .trim()
  .min(1, "ユーザー名を入力してください")
  .min(2, "ユーザー名は2文字以上で入力してください")
  .max(20, "ユーザー名は20文字以内で入力してください")
  .refine(
    (v) => /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\-_ ]+$/.test(v),
    "ユーザー名に使用できない文字が含まれています",
  )
  .refine(
    (v) => !RESERVED_WORDS.includes(v.trim().toLowerCase()),
    "別のユーザー名を選択してください",
  );

export const VALID_GENRES = [
  "アクション",
  "コメディ",
  "ドラマ",
  "ファンタジー",
  "ホラー",
  "ミステリー",
  "ロマンス",
  "SF",
  "スポーツ",
  "アドベンチャー",
  "スリラー",
  "歴史",
  "音楽",
  "日常系",
  "異世界",
] as const;

export type Genre = (typeof VALID_GENRES)[number];

const genreSchema = z.enum(VALID_GENRES, {
  error: () => "有効なジャンルを選択してください",
});

export const profileUpdateSchema = z.object({
  username: usernameSchema.optional(),
  selectedGenres: z
    .array(genreSchema)
    .max(15)
    .refine(
      (genres) => new Set(genres).size === genres.length,
      "ジャンルが重複しています",
    )
    .optional(),
  bio: commentSchema,
  favoriteQuote: commentSchema,
  isPublic: z.boolean().optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

export const WATCH_STATUSES = [
  "watching",
  "completed",
  "on_hold",
  "dropped",
  "plan_to_watch",
] as const;

export type WatchStatus = (typeof WATCH_STATUSES)[number];

export const watchHistoryUpsertSchema = z.object({
  status: z.enum(WATCH_STATUSES, {
    error: () => "有効なステータスを選択してください",
  }),
  score: z
    .number()
    .int()
    .min(1, "スコアは1以上で入力してください")
    .max(10, "スコアは10以下で入力してください")
    .nullable()
    .optional(),
  comment: commentSchema,
  watchedAt: z.string().datetime().nullable().optional(),
});

export type WatchHistoryUpsertInput = z.infer<typeof watchHistoryUpsertSchema>;
