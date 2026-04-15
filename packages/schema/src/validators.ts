import { z } from "zod";

// ---- Email ----
export const emailSchema = z
  .string()
  .min(1, "メールアドレスを入力してください")
  .max(254, "メールアドレスが長すぎます")
  .email("有効なメールアドレスを入力してください");

// ---- Password ----
const WEAK_PATTERNS = [
  /^(.)\1{7,}/, // 同じ文字の繰り返し（8文字以上）
  /^(password|12345678|qwerty|abc123|letmein|admin|user)/i, // 脆弱パターンで始まる
];

export const passwordSchema = z
  .string()
  .min(1, "パスワードを入力してください")
  .min(8, "パスワードは8文字以上で入力してください")
  .max(128, "パスワードは128文字以内で入力してください")
  .refine(
    (v) => /^(?=.*[a-zA-Z])(?=.*\d)/.test(v),
    "パスワードは英字と数字を含む必要があります"
  )
  .refine(
    (v) => !WEAK_PATTERNS.some((p) => p.test(v)),
    "より安全なパスワードを設定してください"
  );

// ---- Username ----
const RESERVED_WORDS = ["admin", "root", "test", "system", "null", "undefined"];

export const usernameSchema = z
  .string()
  .trim()
  .min(1, "ユーザー名を入力してください")
  .min(2, "ユーザー名は2文字以上で入力してください")
  .max(20, "ユーザー名は20文字以内で入力してください")
  .refine(
    (v) => /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\-_ ]+$/.test(v),
    "ユーザー名に使用できない文字が含まれています"
  )
  .refine(
    (v) => !RESERVED_WORDS.some((w) => v.toLowerCase().includes(w)),
    "別のユーザー名を選択してください"
  );

// ---- User ID (Firebase UID 互換: 28文字英数字 or Clerk ID: user_xxxxx) ----
export const userIdSchema = z
  .string()
  .min(1, "ユーザーIDが必要です")
  .refine(
    (v) => /^[a-zA-Z0-9]{28}$/.test(v) || /^user_[a-zA-Z0-9]+$/.test(v),
    "無効なユーザーIDです"
  );

// ---- QR data ----
export const qrDataSchema = z.string().min(1, "QRコードデータが無効です").transform((v, ctx) => {
  // animeishi://user/{userId} スキーム（new URL は authority を正しく扱えないため正規表現で解析）
  const schemeMatch = v.match(/^animeishi:\/\/user\/([a-zA-Z0-9_]+)$/);
  if (schemeMatch) {
    const uid = schemeMatch[1];
    const result = userIdSchema.safeParse(uid);
    if (!result.success) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "無効なユーザーIDです" });
      return z.NEVER;
    }
    return { type: "scheme" as const, userId: uid };
  }

  // https://... viewer URL
  try {
    const url = new URL(v);
    const match = url.pathname.match(/^\/user\/([a-zA-Z0-9_]+)$/);
    if (match) {
      const uid = match[1];
      const result = userIdSchema.safeParse(uid);
      if (!result.success) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "無効なユーザーIDです" });
        return z.NEVER;
      }
      return { type: "url" as const, userId: uid };
    }
  } catch {
    // not a URL
  }

  // 28文字の英数字 (Firebase UID) または Clerk ID
  const result = userIdSchema.safeParse(v);
  if (result.success) {
    return { type: "raw" as const, userId: v };
  }

  ctx.addIssue({ code: z.ZodIssueCode.custom, message: "無効なQRコードです" });
  return z.NEVER;
});

export type QRData = z.infer<typeof qrDataSchema>;

// ---- Year ----
const CURRENT_YEAR = new Date().getFullYear();

export const animeYearSchema = z
  .number()
  .int()
  .min(1950, `1950年から${CURRENT_YEAR + 5}年の間で入力してください`)
  .max(CURRENT_YEAR + 5, `1950年から${CURRENT_YEAR + 5}年の間で入力してください`)
  .optional();

// ---- Comment / bio ----
const INAPPROPRIATE_PATTERNS = [
  /死ね|殺す|バカ|アホ/,
  /https?:\/\/[^\s]+/,
];

export const commentSchema = z
  .string()
  .trim()
  .max(500, "コメントは500文字以内で入力してください")
  .refine(
    (v) => !INAPPROPRIATE_PATTERNS.some((p) => p.test(v)),
    "不適切な内容が含まれています"
  )
  .optional();

// ---- Valid genres ----
export const VALID_GENRES = [
  "アクション", "コメディ", "ドラマ", "ファンタジー", "ホラー",
  "ミステリー", "ロマンス", "SF", "スポーツ", "アドベンチャー",
  "スリラー", "歴史", "音楽", "日常系", "異世界",
] as const;

export type Genre = (typeof VALID_GENRES)[number];

export const genreSchema = z.enum(VALID_GENRES, {
  errorMap: () => ({ message: "有効なジャンルを選択してください" }),
});

// ---- Sign-up form ----
export const signUpSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    passwordConfirmation: z.string().min(1, "パスワードを再入力してください"),
    username: usernameSchema,
  })
  .refine((d) => d.password === d.passwordConfirmation, {
    message: "パスワードが一致しません",
    path: ["passwordConfirmation"],
  });

export type SignUpInput = z.infer<typeof signUpSchema>;

// ---- Sign-in form ----
export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "パスワードを入力してください"),
});

export type SignInInput = z.infer<typeof signInSchema>;

// ---- Profile update ----
export const profileUpdateSchema = z.object({
  username: usernameSchema,
  selectedGenres: z.array(genreSchema).max(15).optional(),
  bio: commentSchema,
  favoriteQuote: commentSchema,
  isPublic: z.boolean().optional(),
});

export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;
