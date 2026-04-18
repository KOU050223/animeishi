import { signInSchema, signUpSchema } from "@/lib/validators";

// ---- signInSchema ----
describe("signInSchema", () => {
  it("有効なサインインデータを受け入れる", () => {
    expect(
      signInSchema.safeParse({ email: "test@example.com", password: "any" })
        .success,
    ).toBe(true);
  });

  it("空のメールを拒否する", () => {
    expect(
      signInSchema.safeParse({ email: "", password: "any" }).success,
    ).toBe(false);
  });

  it("@のないメールアドレスを拒否する", () => {
    expect(
      signInSchema.safeParse({ email: "userexample.com", password: "any" })
        .success,
    ).toBe(false);
  });

  it("空のパスワードを拒否する", () => {
    expect(
      signInSchema.safeParse({ email: "test@example.com", password: "" })
        .success,
    ).toBe(false);
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

  it("パスワードと確認が一致しない場合を拒否する", () => {
    expect(
      signUpSchema.safeParse({ ...valid, passwordConfirmation: "Different1" })
        .success,
    ).toBe(false);
  });

  it("8文字未満のパスワードを拒否する", () => {
    expect(
      signUpSchema.safeParse({
        ...valid,
        password: "Ab1",
        passwordConfirmation: "Ab1",
      }).success,
    ).toBe(false);
  });

  it("英字のみのパスワードを拒否する", () => {
    expect(
      signUpSchema.safeParse({
        ...valid,
        password: "abcdefgh",
        passwordConfirmation: "abcdefgh",
      }).success,
    ).toBe(false);
  });

  it("脆弱パターンのパスワードを拒否する (password1)", () => {
    expect(
      signUpSchema.safeParse({
        ...valid,
        password: "password1",
        passwordConfirmation: "password1",
      }).success,
    ).toBe(false);
  });

  it("1文字のユーザー名を拒否する", () => {
    expect(signUpSchema.safeParse({ ...valid, username: "a" }).success).toBe(
      false,
    );
  });

  it("21文字以上のユーザー名を拒否する", () => {
    expect(
      signUpSchema.safeParse({ ...valid, username: "a".repeat(21) }).success,
    ).toBe(false);
  });

  it("予約語 admin をユーザー名として拒否する", () => {
    expect(
      signUpSchema.safeParse({ ...valid, username: "admin" }).success,
    ).toBe(false);
  });

  it("日本語ユーザー名を受け入れる", () => {
    expect(
      signUpSchema.safeParse({ ...valid, username: "アニメ太郎" }).success,
    ).toBe(true);
  });

  it("無効なメールアドレスを拒否する", () => {
    expect(
      signUpSchema.safeParse({ ...valid, email: "invalid" }).success,
    ).toBe(false);
  });
});
