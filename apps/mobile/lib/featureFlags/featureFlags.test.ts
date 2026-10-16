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

// googleSignIn / passkey（web）の既定値は接続先 Clerk インスタンスを
// publishable key で判定する（jest.setup.js で pk_test_ を設定済み）。
// pk_live_ は本番インスタンス。EAS preview も pk_live_ を指すため、
// 環境名ではなくキーの種別で無効になることを確認する。
describe("featureFlags.googleSignIn（issue #89）", () => {
  it("開発インスタンスのキー（pk_test_）では既定で有効", () => {
    expect(featureFlags.googleSignIn).toBe(true);
  });

  it("本番インスタンスのキー（pk_live_）では既定で無効", () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_xxx";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { googleSignIn } = require("./googleSignIn");
    expect(googleSignIn).toBe(false);
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_jest";
  });

  it("preview 環境名でも pk_live_ なら既定で無効", () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_ENVIRONMENT = "preview";
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_xxx";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { googleSignIn } = require("./googleSignIn");
    expect(googleSignIn).toBe(false);
    delete process.env.EXPO_PUBLIC_ENVIRONMENT;
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_jest";
  });

  it("キー未設定では既定で無効", () => {
    jest.resetModules();
    delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { googleSignIn } = require("./googleSignIn");
    expect(googleSignIn).toBe(false);
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_jest";
  });

  it("EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN で環境に関わらず上書きできる", () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_xxx";
    process.env.EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN = "true";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { googleSignIn } = require("./googleSignIn");
    expect(googleSignIn).toBe(true);
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_jest";
    delete process.env.EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN;
  });
});

describe("featureFlags.passkey（issue #181）", () => {
  it("ネイティブでは常に無効（@clerk/expo-passkeys / Associated Domains 待ち）", () => {
    expect(featureFlags.passkey).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { passkey: passkeyNative } = require("./passkey.native");
    expect(passkeyNative).toBe(false);
  });

  it("Web は pk_test_ で既定有効、pk_live_ で既定無効", () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { passkey: passkeyWeb } = require("./passkey.web");
    expect(passkeyWeb).toBe(true);

    jest.resetModules();
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_xxx";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { passkey: passkeyWebLive } = require("./passkey.web");
    expect(passkeyWebLive).toBe(false);
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_jest";
  });
});
