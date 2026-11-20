// 印刷用書き出し（issue #665）の画像サイズ計算。
// 仕上がり 91×55mm・塗り足し 3mm・300dpi の入稿向けに、
// 塗り足し込み（97×61mm 相当）の PNG サイズを決める。

export const MM_PER_INCH = 25.4;

/** 名刺の仕上がりサイズ（mm）。一般的な名刺サイズ。 */
export const PRINT_CARD_WIDTH_MM = 91;
export const PRINT_CARD_HEIGHT_MM = 55;

/** 塗り足し幅（mm）。四辺すべてに付ける。 */
export const PRINT_BLEED_MM = 3;

/** 書き出し解像度（dpi）。 */
export const PRINT_DPI = 300;

/** 裏面の QR の一辺（mm）。 */
export const PRINT_BACK_QR_MM = 30;

export function mmToPx(mm: number, dpi: number): number {
  return Math.round((mm / MM_PER_INCH) * dpi);
}

export type PrintLayout = {
  /** 塗り足し込みの画像サイズ（px）。 */
  widthPx: number;
  heightPx: number;
  /** 塗り足し幅（px）。 */
  bleedPx: number;
  /** 仕上がり（トンボ内）のサイズ（px）。 */
  cardWidthPx: number;
  cardHeightPx: number;
  /** 裏面 QR の一辺（px）。 */
  backQrPx: number;
  dpi: number;
};

export function getPrintLayout(dpi: number = PRINT_DPI): PrintLayout {
  const bleedPx = mmToPx(PRINT_BLEED_MM, dpi);
  return {
    // 塗り足し込みのサイズは合計 mm（97×61）から換算する
    // （cardWidthPx + bleedPx*2 とは丸めで 1px ずれうる）。
    widthPx: mmToPx(PRINT_CARD_WIDTH_MM + PRINT_BLEED_MM * 2, dpi),
    heightPx: mmToPx(PRINT_CARD_HEIGHT_MM + PRINT_BLEED_MM * 2, dpi),
    bleedPx,
    cardWidthPx: mmToPx(PRINT_CARD_WIDTH_MM, dpi),
    cardHeightPx: mmToPx(PRINT_CARD_HEIGHT_MM, dpi),
    backQrPx: mmToPx(PRINT_BACK_QR_MM, dpi),
    dpi,
  };
}

export type CoverRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * 指定アスペクト比（幅/高）の矩形が領域を覆う（cover）ための
 * 位置とサイズ。はみ出した分は領域外に均等にはみ出す。
 * 表面の描画で名刺デザインを塗り足し端まで広げるために使う。
 */
export function getCoverRect(
  area: { width: number; height: number },
  aspectRatio: number,
): CoverRect {
  if (aspectRatio >= area.width / area.height) {
    const width = area.height * aspectRatio;
    return { x: (area.width - width) / 2, y: 0, width, height: area.height };
  }
  const height = area.width / aspectRatio;
  return { x: 0, y: (area.height - height) / 2, width: area.width, height };
}
