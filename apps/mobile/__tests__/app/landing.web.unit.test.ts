import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const appDir = join(__dirname, "../../app");
const landing = readFileSync(join(appDir, "index.web.tsx"), "utf8");
const layout = readFileSync(join(appDir, "_layout.tsx"), "utf8");

describe("Web landing route", () => {
  it("renders sample card, tier list, and watch analysis for signed-out visitors", () => {
    expect(landing).toContain(
      'if (isSignedIn) return <Redirect href="/(tabs)/(home)" />',
    );
    expect(landing).toContain('testID="landing-page"');
    expect(landing).toContain("星乃 みなと");
    expect(landing).toContain("推しのTier表を、SNSでシェア");
    expect(landing).toContain("今期を振り返って、好きの傾向を発見");
    expect(landing).toContain("AIのひとこと");
  });

  it("links the landing page CTAs to existing sign-in and sign-up routes", () => {
    expect(landing.match(/href="\/\(auth\)\/sign-in"/g)).toHaveLength(2);
    expect(landing.match(/href="\/\(auth\)\/sign-up"/g)).toHaveLength(3);
  });

  it("keeps native visitors on the existing home route and protects other routes", () => {
    const nativeIndex = readFileSync(join(appDir, "index.tsx"), "utf8");

    expect(layout).toContain('segments[0] === "index"');
    expect(layout).toContain('router.replace("/(auth)/sign-in")');
    expect(layout).toContain("isSignedIn &&\n      inAuthGroup");
    expect(nativeIndex).toContain('<Redirect href="/(tabs)/(home)" />');
    expect(existsSync(join(appDir, "index.web.tsx"))).toBe(true);
  });
});
