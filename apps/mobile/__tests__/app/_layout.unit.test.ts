import { describe, expect, test } from "vitest";
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

  test("declares the public support route", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "app/_layout.tsx"),
      "utf8",
    );

    // ストア掲載のサポート URL（/support）も未ログインで開ける必要がある。
    expect(source).toContain('<Stack.Screen name="support" />');
    expect(source).toContain('segments[0] === "support"');
  });

  test("declares the changelog route", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "app/_layout.tsx"),
      "utf8",
    );

    // 機能一覧・更新情報ページ（issue #98）。プロフィール画面から遷移する
    // アプリ内ページのため公開グループには入れない。
    expect(source).toContain('<Stack.Screen name="changelog" />');
  });

  test("exports a route ErrorBoundary so crashes get a retry UI", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "app/_layout.tsx"),
      "utf8",
    );

    // expo-router はルートモジュールの ErrorBoundary export を捕捉に使う。
    expect(source).toContain("export function ErrorBoundary");
  });
});
