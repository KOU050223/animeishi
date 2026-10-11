import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../..");

describe("root router layout", () => {
  test("declares the concrete public user profile route", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "app/_layout.tsx"),
      "utf8",
    );

    expect(source).toContain('<Stack.Screen name="user/[uid]" />');
    expect(source).not.toContain('<Stack.Screen name="user" />');
  });

  test("declares the public legal document routes", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "app/_layout.tsx"),
      "utf8",
    );

    // ストア審査・未ログイン閲覧のため /privacy /terms は公開ルートとして宣言する。
    expect(source).toContain('<Stack.Screen name="privacy" />');
    expect(source).toContain('<Stack.Screen name="terms" />');
    // AuthGuard の公開グループにも含める（未ログインで sign-in へ飛ばさない）。
    expect(source).toContain('segments[0] === "privacy"');
    expect(source).toContain('segments[0] === "terms"');
  });
});
