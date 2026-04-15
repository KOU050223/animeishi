import { describe, it, expect } from "vitest";
import {
  emailSchema,
  passwordSchema,
  usernameSchema,
  userIdSchema,
  qrDataSchema,
  commentSchema,
  genreSchema,
  signUpSchema,
  signInSchema,
} from "../src/validators.js";

// ---- helpers ----
function ok<T>(schema: { safeParse: (v: T) => { success: boolean } }, value: T) {
  const r = schema.safeParse(value);
  expect(r.success, `expected success for: ${JSON.stringify(value)}`).toBe(true);
}

function err<T>(
  schema: { safeParse: (v: T) => { success: boolean; error?: { issues: { message: string }[] } } },
  value: T,
  expectedMessage: string
) {
  const r = schema.safeParse(value);
  expect(r.success, `expected failure for: ${JSON.stringify(value)}`).toBe(false);
  if (!r.success && r.error) {
    const messages = r.error.issues.map((i) => i.message);
    expect(messages).toContain(expectedMessage);
  }
}

// =====================
// Email
// =====================
describe("emailSchema", () => {
  it("有効なメールアドレスを受け入れる", () => {
    ok(emailSchema, "test@example.com");
    ok(emailSchema, "user.name@domain.co.jp");
    ok(emailSchema, "test+tag@example.org");
  });

  it("空文字は拒否する", () => {
    err(emailSchema, "", "メールアドレスを入力してください");
  });

  it("形式が不正なメールアドレスは拒否する", () => {
    err(emailSchema, "invalid-email", "有効なメールアドレスを入力してください");
    err(emailSchema, "test@", "有効なメールアドレスを入力してください");
    err(emailSchema, "@example.com", "有効なメールアドレスを入力してください");
    err(emailSchema, "test.example.com", "有効なメールアドレスを入力してください");
  });

  it("254文字超は拒否する", () => {
    const long = "a".repeat(250) + "@b.co";
    err(emailSchema, long, "メールアドレスが長すぎます");
  });
});

// =====================
// Password
// =====================
describe("passwordSchema", () => {
  it("有効なパスワードを受け入れる", () => {
    ok(passwordSchema, "MySecure1");
    ok(passwordSchema, "Test1234");
    ok(passwordSchema, "Abcdef12");
  });

  it("空文字は拒否する", () => {
    err(passwordSchema, "", "パスワードを入力してください");
  });

  it("8文字未満は拒否する", () => {
    err(passwordSchema, "abc123", "パスワードは8文字以上で入力してください");
  });

  it("128文字超は拒否する", () => {
    const long = "Abcdef1" + "a".repeat(122);
    err(passwordSchema, long, "パスワードは128文字以内で入力してください");
  });

  it("英字のみは拒否する", () => {
    err(passwordSchema, "password", "パスワードは英字と数字を含む必要があります");
  });

  it("数字のみは拒否する", () => {
    err(passwordSchema, "12345678", "パスワードは英字と数字を含む必要があります");
  });

  it("脆弱パスワードは拒否する", () => {
    err(passwordSchema, "password1", "より安全なパスワードを設定してください");
    err(passwordSchema, "aaaaaaaa1", "より安全なパスワードを設定してください");
  });
});

// =====================
// Username
// =====================
describe("usernameSchema", () => {
  it("有効なユーザー名を受け入れる", () => {
    ok(usernameSchema, "テストユーザー");
    ok(usernameSchema, "ValidUser");
    ok(usernameSchema, "ユーザー123");
  });

  it("空文字は拒否する", () => {
    err(usernameSchema, "", "ユーザー名を入力してください");
  });

  it("1文字は拒否する", () => {
    err(usernameSchema, "a", "ユーザー名は2文字以上で入力してください");
  });

  it("21文字以上は拒否する", () => {
    err(usernameSchema, "a".repeat(21), "ユーザー名は20文字以内で入力してください");
  });

  it("予約語を含む名前は拒否する", () => {
    err(usernameSchema, "admin太郎", "別のユーザー名を選択してください");
    err(usernameSchema, "testuser", "別のユーザー名を選択してください");
  });

  it("使用不可文字は拒否する", () => {
    err(usernameSchema, "user@name", "ユーザー名に使用できない文字が含まれています");
    err(usernameSchema, "user!!", "ユーザー名に使用できない文字が含まれています");
  });
});

// =====================
// User ID
// =====================
describe("userIdSchema", () => {
  it("28文字英数字（Firebase UID）を受け入れる", () => {
    ok(userIdSchema, "abcdefghijklmnopqrstuvwxyz12");
  });

  it("Clerk user_xxx 形式を受け入れる", () => {
    ok(userIdSchema, "user_2abc123def456ghi789jkl");
  });

  it("空文字は拒否する", () => {
    err(userIdSchema, "", "ユーザーIDが必要です");
  });

  it("短すぎるIDは拒否する", () => {
    err(userIdSchema, "short", "無効なユーザーIDです");
  });

  it("29文字以上の英数字のみは拒否する", () => {
    err(userIdSchema, "a".repeat(29), "無効なユーザーIDです");
  });
});

// =====================
// QR Data
// =====================
describe("qrDataSchema", () => {
  const validFirebaseUid = "abcdefghijklmnopqrstuvwxyz12";

  it("28文字UIDを受け入れる", () => {
    const r = qrDataSchema.safeParse(validFirebaseUid);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe("raw");
      expect(r.data.userId).toBe(validFirebaseUid);
    }
  });

  it("animeishi://user/{uid} スキームを受け入れる", () => {
    const r = qrDataSchema.safeParse(`animeishi://user/${validFirebaseUid}`);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe("scheme");
      expect(r.data.userId).toBe(validFirebaseUid);
    }
  });

  it("https viewer URL を受け入れる", () => {
    const r = qrDataSchema.safeParse(
      `https://animeishi-viewer.web.app/user/${validFirebaseUid}`
    );
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.type).toBe("url");
      expect(r.data.userId).toBe(validFirebaseUid);
    }
  });

  it("空文字は拒否する", () => {
    err(qrDataSchema, "", "QRコードデータが無効です");
  });

  it("無効なデータは拒否する", () => {
    err(qrDataSchema, "invalid-data", "無効なQRコードです");
    err(qrDataSchema, "https://example.com/something", "無効なQRコードです");
  });
});

// =====================
// Comment
// =====================
describe("commentSchema", () => {
  it("空文字はオプショナルなので undefined と同等に通す", () => {
    ok(commentSchema, "");
  });

  it("500文字以内は通す", () => {
    ok(commentSchema, "あ".repeat(500));
  });

  it("501文字は拒否する", () => {
    err(commentSchema, "あ".repeat(501), "コメントは500文字以内で入力してください");
  });

  it("不適切な言葉は拒否する", () => {
    err(commentSchema, "死ねばいいのに", "不適切な内容が含まれています");
  });

  it("URLを含むコメントは拒否する", () => {
    err(commentSchema, "見てhttps://example.com/bad", "不適切な内容が含まれています");
  });
});

// =====================
// Genre
// =====================
describe("genreSchema", () => {
  it("有効なジャンルを受け入れる", () => {
    ok(genreSchema, "アクション");
    ok(genreSchema, "SF");
    ok(genreSchema, "異世界");
  });

  it("無効なジャンルは拒否する", () => {
    // @ts-expect-error intentional invalid value
    err(genreSchema, "ギャンブル", "有効なジャンルを選択してください");
  });
});

// =====================
// SignUp form (複合バリデーション)
// =====================
describe("signUpSchema", () => {
  it("パスワードと確認が一致しない場合は拒否する", () => {
    const r = signUpSchema.safeParse({
      email: "test@example.com",
      password: "Secure123",
      passwordConfirmation: "Different1",
      username: "テストユーザー",
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msgs = r.error.issues.map((i) => i.message);
      expect(msgs).toContain("パスワードが一致しません");
    }
  });

  it("全て正常な値は通す", () => {
    ok(signUpSchema, {
      email: "test@example.com",
      password: "Secure123",
      passwordConfirmation: "Secure123",
      username: "テストユーザー",
    });
  });
});

// =====================
// SignIn form
// =====================
describe("signInSchema", () => {
  it("正常な値は通す", () => {
    ok(signInSchema, { email: "test@example.com", password: "anypassword" });
  });

  it("メールが空は拒否する", () => {
    err(
      signInSchema,
      { email: "", password: "anypassword" },
      "メールアドレスを入力してください"
    );
  });
});
