import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

// 旧タブのパスを新しいタブ内セクションへ転送するリダイレクト（issue #170）。
// ディープリンクや Web URL（/watch-history 等）が 404 にならないよう
// app/ 直下のスタブが残っていることを固定する。
const appDir = path.resolve(__dirname, "../../app");

const REDIRECTS: Record<string, string> = {
  "anime-list.tsx": "/(tabs)/library?section=anime",
  "watch-history.tsx": "/(tabs)/library?section=history",
  "favorites.tsx": "/(tabs)/library?section=favorites",
  "qr.tsx": "/(tabs)/social?section=qr",
  "friends.tsx": "/(tabs)/social?section=friends",
};

describe("旧タブパスのリダイレクト", () => {
  test.each(Object.entries(REDIRECTS))(
    "%s は %s へ Redirect する",
    (file, href) => {
      const source = fs.readFileSync(path.join(appDir, file), "utf8");

      expect(source).toContain(`<Redirect href="${href}"`);
    },
  );
});
