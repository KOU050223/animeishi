import * as v from "valibot";

// v.email() は zod の z.email() より厳しく、アポストロフィ入りのローカル部や
// Punycode ラベル（連続ハイフン）を含むドメインを拒否する。従来と同じ判定に
// するため zod v4 の email 正規表現をそのまま使う。
const emailSchema = v.pipe(
  v.string(),
  v.minLength(1, "メールアドレスを入力してください"),
  v.maxLength(254, "メールアドレスが長すぎます"),
  v.regex(
    /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/,
    "有効なメールアドレスを入力してください",
  ),
);

const WEAK_PATTERNS = [
  /^(.)\1{7,}/,
  /^(password|12345678|qwerty|abc123|letmein|admin|user)/i,
];

const passwordSchema = v.pipe(
  v.string(),
  v.minLength(1, "パスワードを入力してください"),
  v.minLength(8, "パスワードは8文字以上で入力してください"),
  v.maxLength(128, "パスワードは128文字以内で入力してください"),
  v.check(
    (input) => /^(?=.*[a-zA-Z])(?=.*\d)/.test(input),
    "パスワードは英字と数字を含む必要があります",
  ),
  v.check(
    (input) => !WEAK_PATTERNS.some((p) => p.test(input)),
    "より安全なパスワードを設定してください",
  ),
);

const RESERVED_WORDS = ["admin", "root", "test", "system", "null", "undefined"];

const usernameSchema = v.pipe(
  v.string(),
  v.trim(),
  v.minLength(1, "ユーザー名を入力してください"),
  v.minLength(2, "ユーザー名は2文字以上で入力してください"),
  v.maxLength(20, "ユーザー名は20文字以内で入力してください"),
  v.check(
    (name) =>
      /^[a-zA-Z0-9\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\-_ @]+$/.test(name),
    "ユーザー名に使用できない文字が含まれています",
  ),
  v.check(
    (name) => !RESERVED_WORDS.includes(name.trim().toLowerCase()),
    "別のユーザー名を選択してください",
  ),
);

export const signUpSchema = v.pipe(
  v.object({
    email: emailSchema,
    password: passwordSchema,
    passwordConfirmation: v.pipe(
      v.string(),
      v.minLength(1, "パスワードを再入力してください"),
    ),
    username: usernameSchema,
  }),
  v.forward(
    v.check(
      (input) => input.password === input.passwordConfirmation,
      "パスワードが一致しません",
    ),
    ["passwordConfirmation"],
  ),
);

export type SignUpInput = v.InferOutput<typeof signUpSchema>;

export const signInSchema = v.object({
  email: emailSchema,
  password: v.pipe(v.string(), v.minLength(1, "パスワードを入力してください")),
});

export type SignInInput = v.InferOutput<typeof signInSchema>;

export const passwordResetEmailSchema = v.object({ email: emailSchema });

export const passwordResetSchema = v.pipe(
  v.object({
    code: v.pipe(
      v.string(),
      v.trim(),
      v.minLength(1, "認証コードを入力してください"),
    ),
    password: passwordSchema,
    passwordConfirmation: v.pipe(
      v.string(),
      v.minLength(1, "パスワードを再入力してください"),
    ),
  }),
  v.forward(
    v.check(
      (input) => input.password === input.passwordConfirmation,
      "パスワードが一致しません",
    ),
    ["passwordConfirmation"],
  ),
);
