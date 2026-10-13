// featureFlags.danimeImport（#158）の既定値テスト。
// jest-expo は iOS プラットフォームで解決するため、@/lib/featureFlags 経由の
// 値は danimeImport.native.ts のものになる。
import { featureFlags } from "@/lib/featureFlags";
import { danimeImport as danimeImportWeb } from "./danimeImport.web";

describe("featureFlags.danimeImport", () => {
  it("ネイティブでは既定で無効（Web 版限定機能）", () => {
    expect(featureFlags.danimeImport).toBe(false);
  });

  it("Web 版では常に有効", () => {
    expect(danimeImportWeb).toBe(true);
  });

  it("EXPO_PUBLIC_FEATURE_DANIME_IMPORT_NATIVE=true でネイティブ再有効化できる", () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_FEATURE_DANIME_IMPORT_NATIVE = "true";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { danimeImport } = require("./danimeImport.native");
    expect(danimeImport).toBe(true);
    delete process.env.EXPO_PUBLIC_FEATURE_DANIME_IMPORT_NATIVE;
  });
});
