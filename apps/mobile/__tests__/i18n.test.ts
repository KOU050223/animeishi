import i18n, { resources, SUPPORTED_LANGUAGES } from "@/lib/i18n";

/** ネストしたオブジェクトをドット記法のリーフキー配列へ平坦化する */
function flattenKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === "object"
      ? flattenKeys(value as Record<string, unknown>, path)
      : [path];
  });
}

/** 文字列中の補間プレースホルダ {{name}} を抽出してソートする */
function placeholders(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return (value.match(/{{\s*\w+\s*}}/g) ?? [])
    .map((p) => p.replace(/\s/g, ""))
    .sort();
}

/** ドット記法キーで翻訳値（文字列）を取り出す */
function lookup(obj: Record<string, unknown>, key: string): string {
  return key.split(".").reduce<unknown>((acc, k) => {
    return acc !== null && typeof acc === "object"
      ? (acc as Record<string, unknown>)[k]
      : undefined;
  }, obj) as string;
}

const jaTranslation = resources.ja.translation as Record<string, unknown>;
const jaKeys = flattenKeys(jaTranslation).sort();

describe("i18n リソースの整合性", () => {
  it("ja を基準に全サポート言語が同一のキー集合を持つ（翻訳漏れ検出）", () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      const translation = resources[lng].translation as Record<string, unknown>;
      const keys = flattenKeys(translation).sort();

      const missing = jaKeys.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !jaKeys.includes(k));

      expect({ lng, missing }).toEqual({ lng, missing: [] });
      expect({ lng, extra }).toEqual({ lng, extra: [] });
    }
  });

  it("全サポート言語で補間プレースホルダが ja と一致する", () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      if (lng === "ja") continue;
      const translation = resources[lng].translation as Record<string, unknown>;

      for (const key of jaKeys) {
        const jaPh = placeholders(lookup(jaTranslation, key));
        const lngPh = placeholders(lookup(translation, key));
        expect({ key, lng, ph: lngPh }).toEqual({ key, lng, ph: jaPh });
      }
    }
  });

  it("全サポート言語で値が空文字でない", () => {
    for (const lng of SUPPORTED_LANGUAGES) {
      const translation = resources[lng].translation as Record<string, unknown>;
      for (const key of jaKeys) {
        expect({ key, lng, empty: lookup(translation, key) === "" }).toEqual({
          key,
          lng,
          empty: false,
        });
      }
    }
  });
});

describe("i18n の言語切り替え", () => {
  // 各テスト後に既定言語(ja)へ戻す
  afterEach(async () => {
    await i18n.changeLanguage("ja");
  });

  it("既定では日本語で解決される", () => {
    expect(i18n.t("auth.signIn.title")).toBe("サインイン");
  });

  it("en に切り替えると英語で解決される（切り替え検証）", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("auth.signIn.title")).toBe("Sign in");
    expect(i18n.t("auth.errors.invalidCredentials")).toBe(
      "Incorrect email address or password",
    );
  });

  it("補間が en でも機能する", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("auth.signUp.verify.description", { email: "a@b.com" })).toBe(
      "Enter the verification code sent to a@b.com",
    );
  });

  it("未対応言語は ja にフォールバックする", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.t("auth.signIn.title")).toBe("サインイン");
  });
});
