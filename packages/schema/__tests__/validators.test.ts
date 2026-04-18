import { describe, it, expect } from "vitest";
import {
  emailSchema,
  passwordSchema,
  usernameSchema,
  userIdSchema,
  qrDataSchema,
  animeYearSchema,
  commentSchema,
  genreSchema,
  signUpSchema,
  signInSchema,
  profileUpdateSchema,
} from "../src/validators";

// ---- emailSchema ----
describe("emailSchema", () => {
  it("有効なメールアドレスを受け入れる", () => {
    expect(emailSchema.safeParse("user@example.com").success).toBe(true);
  });

  it("空文字を拒否する", () => {
    expect(emailSchema.safeParse("").success).toBe(false);
  });

  it("@のないアドレスを拒否する", () => {
    expect(emailSchema.safeParse("userexample.com").success).toBe(false);
  });

  it("254文字を超えるアドレスを拒否する", () => {
    const long = "a".repeat(246) + "@test.com"; // 255文字
    expect(emailSchema.safeParse(long).success).toBe(false);
  });
});

// ---- passwordSchema ----
describe("passwordSchema", () => {
  it("英字と数字を含む8文字以上を受け入れる", () => {
    expect(passwordSchema.safeParse("Secure1!").success).toBe(true);
    expect(passwordSchema.safeParse("MyPass123").success).toBe(true);
  });

  it("8文字未満を拒否する", () => {
    expect(passwordSchema.safeParse("Ab1!").success).toBe(false);
  });

  it("英字のみを拒否する", () => {
    expect(passwordSchema.safeParse("abcdefgh").success).toBe(false);
  });

  it("数字のみを拒否する", () => {
    expect(passwordSchema.safeParse("12345678").success).toBe(false);
  });

  it("脆弱パターンで始まるものを拒否する (password1)", () => {
    expect(passwordSchema.safeParse("password1").success).toBe(false);
  });

  it("脆弱パターンで始まるものを拒否する (admin123)", () => {
    expect(passwordSchema.safeParse("admin123").success).toBe(false);
  });

  it("同じ文字の繰り返し8文字以上を拒否する", () => {
    expect(passwordSchema.safeParse("aaaaaaaa").success).toBe(false);
  });

  it("128文字を超えるものを拒否する", () => {
    const long = "Aa1" + "x".repeat(130);
    expect(passwordSchema.safeParse(long).success).toBe(false);
  });
});

// ---- usernameSchema ----
describe("usernameSchema", () => {
  it("有効な英数字ユーザー名を受け入れる", () => {
    expect(usernameSchema.safeParse("myUser123").success).toBe(true);
  });

  it("日本語を含むユーザー名を受け入れる", () => {
    expect(usernameSchema.safeParse("アニメ太郎").success).toBe(true);
  });

  it("ハイフン・アンダースコア・スペースを受け入れる", () => {
    expect(usernameSchema.safeParse("user-name_ok here").success).toBe(true);
  });

  it("1文字を拒否する", () => {
    expect(usernameSchema.safeParse("a").success).toBe(false);
  });

  it("21文字以上を拒否する", () => {
    expect(usernameSchema.safeParse("a".repeat(21)).success).toBe(false);
  });

  it("予約語 admin を拒否する", () => {
    expect(usernameSchema.safeParse("admin").success).toBe(false);
  });

  it("予約語と完全一致する文字列を拒否する (root)", () => {
    expect(usernameSchema.safeParse("root").success).toBe(false);
  });

  it("予約語を含むが完全一致でない文字列は受け入れる", () => {
    expect(usernameSchema.safeParse("super_admin_user").success).toBe(true);
  });

  it("特殊記号を拒否する", () => {
    expect(usernameSchema.safeParse("user@name").success).toBe(false);
  });
});

// ---- userIdSchema ----
describe("userIdSchema", () => {
  it("28文字の英数字 (Firebase UID) を受け入れる", () => {
    expect(userIdSchema.safeParse("a".repeat(28)).success).toBe(true);
    expect(userIdSchema.safeParse("AbCdEf1234567890AbCdEf123456").success).toBe(
      true,
    );
  });

  it("Clerk ID (user_xxx) を受け入れる", () => {
    expect(userIdSchema.safeParse("user_2abc123XYZ").success).toBe(true);
  });

  it("27文字を拒否する", () => {
    expect(userIdSchema.safeParse("a".repeat(27)).success).toBe(false);
  });

  it("29文字を拒否する", () => {
    expect(userIdSchema.safeParse("a".repeat(29)).success).toBe(false);
  });

  it("空文字を拒否する", () => {
    expect(userIdSchema.safeParse("").success).toBe(false);
  });
});

// ---- qrDataSchema ----
describe("qrDataSchema", () => {
  const validFirebaseUid = "AbCdEf1234567890AbCdEf123456";
  const validClerkUid = "user_2abc123XYZ";

  it("animeishi://user/{uid} スキームを解析する (Firebase UID)", () => {
    const result = qrDataSchema.safeParse(
      `animeishi://user/${validFirebaseUid}`,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("scheme");
      expect(result.data.userId).toBe(validFirebaseUid);
    }
  });

  it("animeishi://user/{uid} スキームを解析する (Clerk ID)", () => {
    const result = qrDataSchema.safeParse(`animeishi://user/${validClerkUid}`);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("scheme");
      expect(result.data.userId).toBe(validClerkUid);
    }
  });

  it("https://viewer URL を解析する", () => {
    const result = qrDataSchema.safeParse(
      `https://animeishi-viewer.web.app/user/${validFirebaseUid}`,
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("url");
      expect(result.data.userId).toBe(validFirebaseUid);
    }
  });

  it("28文字の生 UID を解析する", () => {
    const result = qrDataSchema.safeParse(validFirebaseUid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("raw");
      expect(result.data.userId).toBe(validFirebaseUid);
    }
  });

  it("無効な文字列を拒否する", () => {
    expect(qrDataSchema.safeParse("invalid-qr-data").success).toBe(false);
  });

  it("空文字を拒否する", () => {
    expect(qrDataSchema.safeParse("").success).toBe(false);
  });
});

// ---- animeYearSchema ----
describe("animeYearSchema", () => {
  it("有効な年を受け入れる", () => {
    expect(animeYearSchema.safeParse(2020).success).toBe(true);
    expect(animeYearSchema.safeParse(1950).success).toBe(true);
  });

  it("undefined を受け入れる (optional)", () => {
    expect(animeYearSchema.safeParse(undefined).success).toBe(true);
  });

  it("1949年を拒否する", () => {
    expect(animeYearSchema.safeParse(1949).success).toBe(false);
  });

  it("5年以上先の年を拒否する", () => {
    const tooFar = new Date().getFullYear() + 6;
    expect(animeYearSchema.safeParse(tooFar).success).toBe(false);
  });
});

// ---- commentSchema ----
describe("commentSchema", () => {
  it("通常のコメントを受け入れる", () => {
    expect(commentSchema.safeParse("好きなアニメです").success).toBe(true);
  });

  it("undefined を受け入れる (optional)", () => {
    expect(commentSchema.safeParse(undefined).success).toBe(true);
  });

  it("500文字を超えるコメントを拒否する", () => {
    expect(commentSchema.safeParse("あ".repeat(501)).success).toBe(false);
  });

  it("不適切な言葉を拒否する", () => {
    expect(commentSchema.safeParse("死ねと思う").success).toBe(false);
  });

  it("URLを含むコメントを拒否する", () => {
    expect(commentSchema.safeParse("見てhttps://example.com").success).toBe(
      false,
    );
  });
});

// ---- genreSchema ----
describe("genreSchema", () => {
  it("有効なジャンルを受け入れる", () => {
    expect(genreSchema.safeParse("アクション").success).toBe(true);
    expect(genreSchema.safeParse("SF").success).toBe(true);
    expect(genreSchema.safeParse("異世界").success).toBe(true);
  });

  it("無効なジャンルを拒否する", () => {
    expect(genreSchema.safeParse("不明なジャンル").success).toBe(false);
  });
});

// ---- signUpSchema ----
describe("signUpSchema", () => {
  const valid = {
    email: "user@example.com",
    password: "MyPass123",
    passwordConfirmation: "MyPass123",
    username: "myuser",
  };

  it("有効なサインアップデータを受け入れる", () => {
    expect(signUpSchema.safeParse(valid).success).toBe(true);
  });

  it("パスワードが一致しない場合を拒否する", () => {
    const result = signUpSchema.safeParse({
      ...valid,
      passwordConfirmation: "Different1",
    });
    expect(result.success).toBe(false);
  });
});

// ---- signInSchema ----
describe("signInSchema", () => {
  it("有効なサインインデータを受け入れる", () => {
    expect(
      signInSchema.safeParse({ email: "test@example.com", password: "any" })
        .success,
    ).toBe(true);
  });

  it("メールなしを拒否する", () => {
    expect(signInSchema.safeParse({ email: "", password: "any" }).success).toBe(
      false,
    );
  });
});

// ---- profileUpdateSchema ----
describe("profileUpdateSchema", () => {
  it("有効なプロフィール更新を受け入れる", () => {
    const input = {
      username: "newname",
      selectedGenres: ["アクション", "SF"],
      isPublic: true,
    };
    expect(profileUpdateSchema.safeParse(input).success).toBe(true);
  });

  it("無効なジャンルを含む場合を拒否する", () => {
    const input = { username: "newname", selectedGenres: ["無効ジャンル"] };
    expect(profileUpdateSchema.safeParse(input).success).toBe(false);
  });
});
