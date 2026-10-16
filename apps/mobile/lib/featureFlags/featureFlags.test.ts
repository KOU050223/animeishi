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

describe("featureFlags.googleSignIn（issue #89）", () => {
  it("EXPO_PUBLIC_ENVIRONMENT 未設定（dev/preview 相当）では既定で有効", () => {
    expect(featureFlags.googleSignIn).toBe(true);
  });

  it("production 環境では既定で無効", () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_ENVIRONMENT = "production";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { googleSignIn } = require("./googleSignIn");
    expect(googleSignIn).toBe(false);
    delete process.env.EXPO_PUBLIC_ENVIRONMENT;
  });

  it("preview でも本番 Clerk キー（pk_live_）なら既定で無効", () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_ENVIRONMENT = "preview";
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_xxx";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { googleSignIn } = require("./googleSignIn");
    expect(googleSignIn).toBe(false);
    delete process.env.EXPO_PUBLIC_ENVIRONMENT;
    delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  });

  it("EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN で環境に関わらず上書きできる", () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_ENVIRONMENT = "production";
    process.env.EXPO_PUBLIC_FEATURE_GOOGLE_SIGN_IN = "true";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { googleSignIn } = require("./googleSignIn");
    expect(googleSignIn).toBe(true);
    delete process.env.EXPO_PUBLIC_ENVIRONMENT;
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

  it("Web は production で既定無効、dev/preview で既定有効", () => {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { passkey: passkeyWeb } = require("./passkey.web");
    expect(passkeyWeb).toBe(true);

    jest.resetModules();
    process.env.EXPO_PUBLIC_ENVIRONMENT = "production";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { passkey: passkeyWebProd } = require("./passkey.web");
    expect(passkeyWebProd).toBe(false);
    delete process.env.EXPO_PUBLIC_ENVIRONMENT;
  });

  it("Web は preview でも本番 Clerk キー（pk_live_）なら既定で無効", () => {
    jest.resetModules();
    process.env.EXPO_PUBLIC_ENVIRONMENT = "preview";
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_live_xxx";
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { passkey: passkeyWebLive } = require("./passkey.web");
    expect(passkeyWebLive).toBe(false);
    delete process.env.EXPO_PUBLIC_ENVIRONMENT;
    delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  });
});
