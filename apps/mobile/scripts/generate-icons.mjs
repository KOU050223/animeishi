// assets/images/*.svg から app.json で参照する PNG を生成する。
// 使い方: pnpm --filter @animeishi/mobile generate:icons
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const imagesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "../assets/images",
);

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
