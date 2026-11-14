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

  test("declares the incoming share route", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "app/_layout.tsx"),
      "utf8",
    );

    // 共有受信の中継画面（issue #316）。遷移先の user/[uid] が公開のため、
    // 未ログインでも共有フローを通せるよう公開グループに含める。
    expect(source).toContain('<Stack.Screen name="incoming-share"');
    expect(source).toContain('segments[0] === "incoming-share"');
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

  test("sets a default header title so route names never leak into the header", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "app/_layout.tsx"),
      "utf8",
    );

    // Web の画面モジュールは遅延読み込みで、解決前は画面側の
    // <Stack.Screen options> が効かない。title 未指定の画面は
    // React Navigation が route.name（"event/[slug]" 等）をヘッダーに
    // 出すため、ルート Stack の screenOptions に既定タイトルを置く
    // （issue #525）。
    expect(source).toContain('title: t("読み込み中...")');
  });

  test("follows the OS appearance with a navigation ThemeProvider", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "app/_layout.tsx"),
      "utf8",
    );

    // expo-router の NavigationContainer はテーマ未指定だと DefaultTheme
    // （light）で固定され、ネイティブヘッダーがダークに追従しない。
    // スキームに応じて ThemeProvider で DarkTheme/DefaultTheme を渡す。
    expect(source).toContain("ThemeProvider");
    expect(source).toContain("DarkTheme");
    expect(source).toContain("useColorScheme");
    expect(source).toContain(
      'colorScheme === "dark" ? DarkTheme : DefaultTheme',
    );
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
