import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const publicDir = join(__dirname, "../public");

const manifest = JSON.parse(
  readFileSync(join(publicDir, "manifest.webmanifest"), "utf8"),
) as {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: { src: string; sizes: string; type: string; purpose?: string }[];
};

function readPngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  // PNG IHDR: 8 バイトシグネチャ + 4 バイト長 + "IHDR" の直後に幅・高さの uint32
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("PWA manifest", () => {
  it("ホーム画面追加に必要な基本フィールドを持つ", () => {
    expect(manifest.name).toBe("Animeishi");
    expect(manifest.short_name).toBe("Animeishi");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
  });

  it("any と maskable の両方で 192/512 アイコンを宣言し、実ファイルとサイズが一致する", () => {
    for (const purpose of ["any", "maskable"]) {
      for (const size of [192, 512]) {
        const icon = manifest.icons.find(
          (i) => i.purpose === purpose && i.sizes === `${size}x${size}`,
        );
        expect(icon, `${purpose} ${size}`).toBeDefined();
        const { width, height } = readPngSize(join(publicDir, icon!.src));
        expect([width, height]).toEqual([size, size]);
      }
    }
  });
});

describe("index.html テンプレート", () => {
  const html = readFileSync(join(publicDir, "index.html"), "utf8");

  it("Expo のテンプレートプレースホルダを保持する", () => {
    expect(html).toContain("%WEB_TITLE%");
    expect(html).toContain("%LANG_ISO_CODE%");
  });

  it("manifest と apple-touch-icon を参照する", () => {
    expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
  });

  it("apple-touch-icon が iOS 要求の 180x180 不透過 PNG である", () => {
    const file = join(publicDir, "apple-touch-icon.png");
    expect(readPngSize(file)).toEqual({ width: 180, height: 180 });
    // IHDR 13 バイト目の color type が 2（RGB）ならアルファを持たない
    expect(readFileSync(file).readUInt8(25)).toBe(2);
  });
});
