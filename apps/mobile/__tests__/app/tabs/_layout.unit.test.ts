import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../../..");

function tabsLayoutSource(): string {
  return fs.readFileSync(path.join(rootDir, "app/(tabs)/_layout.tsx"), "utf8");
}

describe("(tabs) layout", () => {
  test("profile tab exposes a stable testID for Maestro E2E", () => {
    const source = tabsLayoutSource();

    // .maestro/subflows/delete-account.yaml はこの ID でプロフィールタブを
    // タップする。accessibilityLabel だけだとタブバー内で誤タップするため
    // tabBarButtonTestID を固定値にしている。変更する場合は Maestro 側も
    // 合わせて更新すること。
    expect(source).toContain('tabBarButtonTestID: "profile-tab-button"');
  });

  // 4 タブ化（issue #170）。ホーム / ライブラリ / QR・フレンド / プロフの
  // 4 つだけをタブに出す。旧タブのパスは app/ 直下のリダイレクトが引き継ぐ。
  test("タブは ホーム / ライブラリ / QR・フレンド / プロフ の 4 つだけ", () => {
    const source = tabsLayoutSource();
    const names = [...source.matchAll(/<Tabs\.Screen\s+name="([^"]+)"/g)].map(
      (m) => m[1],
    );

    expect(names).toEqual(["index", "library", "social", "profile"]);
  });
});
