import fs from "node:fs";
import path from "node:path";

// Expo Router はプラットフォーム拡張子（.native / .web / .ios / .android）
// だけで構成されたルートを実行時エラー（RCTFatalException）にする。
// app/ 配下で拡張子分割する場合は、必ず拡張子なしのフォールバック
// ファイル（foo.tsx）を並置する必要がある。
const appDir = path.resolve(__dirname, "../../app");
const PLATFORM_EXT = /\.(native|web|ios|android)\.(tsx?|jsx?)$/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

describe("app/ ルートのプラットフォーム拡張子分割", () => {
  it("拡張子分割したルートにはフォールバック（拡張子なし）ファイルがある", () => {
    const offenders = walk(appDir)
      .filter((file) => PLATFORM_EXT.test(path.basename(file)))
      .filter((file) => {
        const fallback = file.replace(PLATFORM_EXT, ".$2");
        return !fs.existsSync(fallback);
      })
      .map((file) => path.relative(appDir, file));

    expect(offenders).toEqual([]);
  });
});
