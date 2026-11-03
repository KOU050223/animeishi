import { describe, expect, it } from "vitest";
import { buildOnboardingDocument } from "./document";
import { MEISHI_TEMPLATES } from "@/lib/meishi/templates";

describe("buildOnboardingDocument", () => {
  it.each(MEISHI_TEMPLATES.map((t) => [t.id, t] as const))(
    "テンプレート %s に推しコラージュを追加する",
    (_id, template) => {
      const doc = buildOnboardingDocument(template);
      const collage = doc.elements.find((e) => e.type === "animeCollage");
      expect(collage).toBeDefined();
      if (collage?.type === "animeCollage") {
        // お気に入りの上位 3 件（オンボーディングで選んだ推し）を出す
        expect(collage.listSource).toBe("favorites");
        expect(collage.limit).toBe(3);
      }
      // テンプレート由来の要素はそのまま残る
      expect(doc.elements.length).toBeGreaterThan(
        template.build().elements.length - 1,
      );
      expect(doc.canvas.aspectRatio).toBe(template.build().canvas.aspectRatio);
    },
  );

  it("元のテンプレート build 結果を書き換えない", () => {
    const template = MEISHI_TEMPLATES[0];
    buildOnboardingDocument(template);
    expect(
      template.build().elements.some((e) => e.type === "animeCollage"),
    ).toBe(false);
  });
});
