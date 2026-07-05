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
});
