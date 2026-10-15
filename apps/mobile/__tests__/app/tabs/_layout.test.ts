import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname, "../../..");

describe("(tabs) layout", () => {
  test("profile tab exposes a stable testID for Maestro E2E", () => {
    const source = fs.readFileSync(
      path.join(rootDir, "app/(tabs)/_layout.tsx"),
      "utf8",
    );

    // .maestro/subflows/delete-account.yaml はこの ID でプロフィールタブを
    // タップする。accessibilityLabel だけだとタブバー内で誤タップするため
    // tabBarButtonTestID を固定値にしている。変更する場合は Maestro 側も
    // 合わせて更新すること。
    expect(source).toContain('tabBarButtonTestID: "profile-tab-button"');
  });
});
