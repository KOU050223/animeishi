// assets/images/*.svg から app.json と public/ の PWA アイコンが参照する PNG を生成する。
// 使い方: pnpm --filter @animeishi/mobile generate:icons
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const imagesDir = join(scriptsDir, "../assets/images");
const publicDir = join(scriptsDir, "../public");

/** @type {{ src: string; out: string; size: number; flatten?: string }[]} */
const targets = [
  // iOS / 共通アイコン。App Store 提出用にアルファを除去する
  { src: "icon.svg", out: "icon.png", size: 1024, flatten: "#4F46E5" },
  // Android アダプティブアイコン前景（透過）
  { src: "adaptive-icon.svg", out: "adaptive-icon.png", size: 1024 },
  // Android 13+ テーマアイコン用モノクロ前景（透過シルエット）
  {
    src: "adaptive-icon-monochrome.svg",
    out: "adaptive-icon-monochrome.png",
    size: 1024,
  },
  // スプラッシュ（ライト / ダーク）
  { src: "splash-icon.svg", out: "splash-icon.png", size: 512 },
  { src: "splash-icon-dark.svg", out: "splash-icon-dark.png", size: 512 },
  // Web favicon
  { src: "favicon.svg", out: "favicon.png", size: 192 },
];

/** @type {{ src: string; out: string; size: number; flatten?: string }[]} */
const publicTargets = [
  // PWA manifest 用（public/icons/）。icon.svg は全面背景つきなので purpose "any" に使う
  { src: "icon.svg", out: "icons/icon-192.png", size: 192 },
  { src: "icon.svg", out: "icons/icon-512.png", size: 512 },
  // maskable は端が円形などに切り抜かれるため、セーフゾーン前提の adaptive-icon を
  // app.json android.adaptiveIcon.backgroundColor と同じ色でベタ塗りして使う
  {
    src: "adaptive-icon.svg",
    out: "icons/maskable-192.png",
    size: 192,
    flatten: "#6D28D9",
  },
  {
    src: "adaptive-icon.svg",
    out: "icons/maskable-512.png",
    size: 512,
    flatten: "#6D28D9",
  },
  // iOS ホーム画面追加用。透過を残すと黒背景になるためベタ塗りする
  {
    src: "icon.svg",
    out: "apple-touch-icon.png",
    size: 180,
    flatten: "#4F46E5",
  },
];

for (const { src, out, size, flatten } of targets) {
  let pipeline = sharp(join(imagesDir, src), { density: 384 }).resize(
    size,
    size,
  );
  if (flatten) {
    pipeline = pipeline.flatten({ background: flatten });
  }
  await pipeline.png().toFile(join(imagesDir, out));
  console.log(`generated ${out} (${size}x${size})`);
}

for (const { src, out, size, flatten } of publicTargets) {
  let pipeline = sharp(join(imagesDir, src), { density: 384 }).resize(
    size,
    size,
  );
  if (flatten) {
    pipeline = pipeline.flatten({ background: flatten });
  }
  const outPath = join(publicDir, out);
  await mkdir(dirname(outPath), { recursive: true });
  await pipeline.png().toFile(outPath);
  console.log(`generated public/${out} (${size}x${size})`);
}
