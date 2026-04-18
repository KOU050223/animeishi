import { z } from "zod";

const emailSchema = z
  .email("有効なメールアドレスを入力してください")
  .min(1, "メールアドレスを入力してください")
  .max(254, "メールアドレスが長すぎます");

const WEAK_PATTERNS = [
  /^(.)\1{7,}/,
  /^(password|12345678|qwerty|abc123|letmein|admin|user)/i,
];

const passwordSchema = z
  .string()
  .min(1, "パスワードを入力してください")
  .min(8, "パスワードは8文字以上で入力してください")
  .max(128, "パスワードは128文字以内で入力してください")
  .refine(
    (v) => /^(?=.*[a-zA-Z])(?=.*\d)/.test(v),
    "パスワードは英字と数字を含む必要があります",
  )
  .refine(
    (v) => !WEAK_PATTERNS.some((p) => p.test(v)),
    "より安全なパスワードを設定してください",
  );

const RESERVED_WORDS = ["admin", "root", "test", "system", "null", "undefined"];

const usernameSchema = z
  .string()
  .trim()
  .min(1, "ユーザー名を入力してください")
  .min(2, "ユーザー名は2文字以上で入力してください")
  .max(20, "ユーザー名は20文字以内で入力してください")
  .refine(
    (v) =>
      /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\-_ ]+$/.test(v),
    "ユーザー名に使用できない文字が含まれています",
  )
  .refine(
    (v) => !RESERVED_WORDS.includes(v.trim().toLowerCase()),
    "別のユーザー名を選択してください",
  );

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

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "パスワードを入力してください"),
});

export type SignInInput = z.infer<typeof signInSchema>;
