import { describe, expect, it } from "vitest";
import { getFittedCanvasWidth, getInspectorHeight } from "./inspectorLayout";

describe("getInspectorHeight", () => {
  it("高さ568ptの画面ではキャンバス用に従来の高さを残す", () => {
    expect(getInspectorHeight(568)).toBe(236);
  });

  it("大きい画面では設定欄を広く表示する", () => {
    expect(getInspectorHeight(800)).toBe(384);
  });
});

describe("getFittedCanvasWidth", () => {
  it("横長画面でもパネルの上に名刺の下端が収まる", () => {
    const width = getFittedCanvasWidth(1024, 700, 384, 1.6);
    expect(width).toBeLessThanOrEqual(560);
    expect(width / 1.6 + 384 + 24).toBeLessThanOrEqual(700);
  });

  it("縦長画面では利用可能な横幅を保つ", () => {
    expect(getFittedCanvasWidth(390, 700, 384, 1.6)).toBe(366);
  });
});
