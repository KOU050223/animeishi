import { describe, expect, it } from "vitest";
import { dragImageFocus, imageContentPosition } from "./imageFocus";

describe("image focus", () => {
  it("焦点未設定の画像は中央で切り抜く", () => {
    expect(imageContentPosition(undefined)).toEqual({
      left: "50%",
      top: "50%",
    });
  });

  it("保存した焦点を表示位置の百分率に変換する", () => {
    expect(imageContentPosition({ x: 0.25, y: 0.8 })).toEqual({
      left: "25%",
      top: "80%",
    });
  });

  it("横方向に余白がある cover 画像を右へドラッグすると左側へ焦点が移る", () => {
    expect(
      dragImageFocus(
        undefined,
        { x: 50, y: 50 },
        { width: 100, height: 100 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ x: 0, y: 0.5 });
  });

  it("切り抜き余地のない軸はドラッグしても動かない", () => {
    expect(
      dragImageFocus(
        { x: 0.3, y: 0.6 },
        { x: -50, y: -50 },
        { width: 100, height: 100 },
        { width: 100, height: 200 },
      ),
    ).toEqual({ x: 0.3, y: 1 });
  });
});
