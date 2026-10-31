import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const tabsDir = path.resolve(__dirname, "../../../app/(tabs)");

function layoutSource(file: "_layout.tsx" | "_layout.web.tsx"): string {
  return fs.readFileSync(path.join(tabsDir, file), "utf8");
}

describe("(tabs) layout", () => {
  // NativeTabs 化（issue #312）。iOS / Android は _layout.tsx の OS 純正
  // タブバー、Web は _layout.web.tsx で従来の JS Tabs を維持する。
  test("ネイティブは NativeTabs、Web は JS Tabs のレイアウトを使う", () => {
    expect(layoutSource("_layout.tsx")).toContain(
      'from "expo-router/native-tabs"',
    );
    expect(layoutSource("_layout.web.tsx")).toContain("<Tabs.Screen");
  });

  test("profile tab exposes a stable testID for Maestro E2E", () => {
    // .maestro/subflows/delete-account.yaml はこの ID でプロフィールタブを
    // タップする。accessibilityLabel だけだとタブバー内で誤タップするため
    // testID（Web 側は tabBarButtonTestID）を固定値にしている。変更する場合は
    // Maestro 側も合わせて更新すること。
    expect(layoutSource("_layout.tsx")).toContain(
      'testID="profile-tab-button"',
    );
    expect(layoutSource("_layout.web.tsx")).toContain(
      'tabBarButtonTestID: "profile-tab-button"',
    );
  });

  // 4 タブ化（issue #170）。ホーム / ライブラリ / QR・フレンド / プロフの
  // 4 つだけをタブに出す。旧タブのパスは app/ 直下のリダイレクトが引き継ぐ。
  test.each(["_layout.tsx", "_layout.web.tsx"] as const)(
    "%s のタブは ホーム / ライブラリ / QR・フレンド / プロフ の 4 つだけ",
    (file) => {
      const names = [
        ...layoutSource(file).matchAll(
          /<(?:NativeTabs\.Trigger|Tabs\.Screen)\s+name="([^"]+)"/g,
        ),
      ].map((m) => m[1]);

      // ホームタブはネスト Stack 化のためルートグループ (home) に入っている。
      // URL はグループ名を含まず引き続き /（issue #395 Phase 2）。
      expect(names).toEqual(["(home)", "library", "social", "profile"]);
    },
  );

  // VoiceOver 等の読み上げ用。ネイティブ側は Trigger の accessibilityLabel、
  // Web 側は tabBarAccessibilityLabel に対応する。
  test.each([
    "ライブラリタブ",
    "QR・フレンドタブ",
    "プロフィールタブ",
  ] as const)("%s のアクセシビリティラベルが両レイアウトにある", (label) => {
    expect(layoutSource("_layout.tsx")).toContain(
      `accessibilityLabel="${label}"`,
    );
    expect(layoutSource("_layout.web.tsx")).toContain(
      `tabBarAccessibilityLabel: "${label}"`,
    );
  });
});
