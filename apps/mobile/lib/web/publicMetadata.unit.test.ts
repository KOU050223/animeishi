import { describe, expect, it } from "vitest";
import { publicMetadata } from "./publicMetadata";

describe("公開ページのメタデータ", () => {
  const meta = publicMetadata("/privacy", "タイトル", "説明文");

  it("canonical を本番オリジンの絶対 URL で返す", () => {
    expect(meta.alternates?.canonical).toBe(
      "https://animeishi.uomi.dev/privacy",
    );
  });

  it("OGP と Twitter カードに同じ title/description を持つ", () => {
    expect(meta.openGraph?.title).toBe("タイトル");
    expect(meta.openGraph?.description).toBe("説明文");
    expect(meta.twitter?.title).toBe("タイトル");
    expect(meta.twitter?.description).toBe("説明文");
  });
});
