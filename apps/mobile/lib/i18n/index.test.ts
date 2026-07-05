import i18n, { resources } from "@/lib/i18n";

/** 文字列中の補間プレースホルダ {{name}} を抽出してソートする */
function placeholders(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return (value.match(/{{\s*\w+\s*}}/g) ?? [])
    .map((p) => p.replace(/\s/g, ""))
    .sort();
}

// 日本語文言をキー兼デフォルト文言とし、en のみ「日本語キー → 英訳」を持つ。
const enTranslation = resources.en.translation as Record<string, string>;
const jaKeys = Object.keys(enTranslation);

describe("i18n リソースの整合性", () => {
  it("en の各エントリは日本語キーに対応する空でない英訳を持つ（翻訳漏れ検出）", () => {
    for (const key of jaKeys) {
      expect({ key, value: enTranslation[key] }).toEqual({
        key,
        value: expect.any(String),
      });
      expect({ key, empty: enTranslation[key] === "" }).toEqual({
        key,
        empty: false,
      });
    }
  });

  it("en の英訳は日本語キーと同じ補間プレースホルダを持つ", () => {
    for (const key of jaKeys) {
      // 日本語キー自身がデフォルト文言のため、キーの {{...}} と英訳の {{...}} が一致する。
      const keyPh = placeholders(key);
      const enPh = placeholders(enTranslation[key]);
      expect({ key, ph: enPh }).toEqual({ key, ph: keyPh });
    }
  });
});

describe("i18n の言語切り替え", () => {
  // 各テスト後に既定言語(ja)へ戻す
  afterEach(async () => {
    await i18n.changeLanguage("ja");
  });

  it("既定ではキー（=日本語文言）がそのまま解決される", () => {
    expect(i18n.t("サインイン")).toBe("サインイン");
  });

  it("en に切り替えると英語で解決される（切り替え検証）", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("サインイン")).toBe("Sign in");
    expect(i18n.t("メールアドレスまたはパスワードが違います")).toBe(
      "Incorrect email address or password",
    );
  });

  it("補間が en でも機能する", async () => {
    await i18n.changeLanguage("en");
    expect(
      i18n.t("{{email}} に送信された認証コードを入力してください", {
        email: "a@b.com",
      }),
    ).toBe("Enter the verification code sent to a@b.com");
  });

  it("未対応言語は ja にフォールバックする（キーがそのまま返る）", async () => {
    await i18n.changeLanguage("fr");
    expect(i18n.t("サインイン")).toBe("サインイン");
  });
});
