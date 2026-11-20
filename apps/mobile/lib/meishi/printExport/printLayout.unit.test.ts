import { describe, expect, it } from "vitest";
import {
  getCoverRect,
  getPrintLayout,
  mmToPx,
  PRINT_BLEED_MM,
  PRINT_CARD_HEIGHT_MM,
  PRINT_CARD_WIDTH_MM,
} from "./printLayout";

describe("mmToPx", () => {
  it("300dpi で 91mm は約1075pxになる", () => {
    expect(mmToPx(91, 300)).toBe(1075);
  });

  it("25.4mm（1インチ）は dpi と同じpxになる", () => {
    expect(mmToPx(25.4, 300)).toBe(300);
    expect(mmToPx(25.4, 600)).toBe(600);
  });
});

describe("getPrintLayout", () => {
  it("300dpi で 97×61mm 相当（塗り足し込み）のサイズを返す", () => {
    const layout = getPrintLayout();
    // 97mm ≒ 1145.7px、61mm ≒ 720.5px
    expect(layout.widthPx).toBe(1146);
    expect(layout.heightPx).toBe(720);
  });

  it("仕上がり・塗り足し・QR の各サイズを dpi に比例して返す", () => {
    const layout = getPrintLayout(300);
    expect(layout.cardWidthPx).toBe(mmToPx(PRINT_CARD_WIDTH_MM, 300));
    expect(layout.cardHeightPx).toBe(mmToPx(PRINT_CARD_HEIGHT_MM, 300));
    expect(layout.bleedPx).toBe(mmToPx(PRINT_BLEED_MM, 300));
    expect(layout.backQrPx).toBe(mmToPx(30, 300));
    expect(layout.dpi).toBe(300);
  });

  it("dpi を上げると画像サイズも比例して大きくなる", () => {
    const l300 = getPrintLayout(300);
    const l600 = getPrintLayout(600);
    // 合計 mm から個別に丸めるため誤差は 1px まで
    expect(Math.abs(l600.widthPx - l300.widthPx * 2)).toBeLessThanOrEqual(1);
    expect(Math.abs(l600.heightPx - l300.heightPx * 2)).toBeLessThanOrEqual(1);
  });
});

describe("getCoverRect", () => {
  it("領域より横長の矩形は左右にはみ出す", () => {
    // 名刺（1.6）を 97×61mm（≒1.59）の領域に覆わせる
    const rect = getCoverRect({ width: 1146, height: 720 }, 1.6);
    expect(rect.height).toBe(720);
    expect(rect.width).toBe(1152);
    expect(rect.y).toBe(0);
    expect(rect.x).toBe((1146 - 1152) / 2);
    // 領域を完全に覆う
    expect(rect.x).toBeLessThanOrEqual(0);
    expect(rect.x + rect.width).toBeGreaterThanOrEqual(1146);
  });

  it("領域より縦長の矩形は上下にはみ出す", () => {
    const rect = getCoverRect({ width: 100, height: 100 }, 0.5);
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(200);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(-50);
  });

  it("同じアスペクト比なら領域にぴったり収まる", () => {
    const rect = getCoverRect({ width: 160, height: 100 }, 1.6);
    expect(rect).toEqual({ x: 0, y: 0, width: 160, height: 100 });
  });
});
