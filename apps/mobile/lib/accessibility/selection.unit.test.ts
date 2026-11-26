import { describe, expect, it } from "vitest";
import { selectionAccessibilityProps as nativeSelectionAccessibilityProps } from "./selection.native";
import { selectionAccessibilityProps as webSelectionAccessibilityProps } from "./selection.web";

describe("selectionAccessibilityProps", () => {
  it("Web では選択状態を aria-pressed として返す", () => {
    expect(webSelectionAccessibilityProps(true)).toEqual({
      "aria-pressed": true,
    });
    expect(webSelectionAccessibilityProps(false)).toEqual({
      "aria-pressed": false,
    });
  });

  it("ネイティブでは accessibilityState に任せて追加属性を返さない", () => {
    expect(nativeSelectionAccessibilityProps(true)).toEqual({});
    expect(nativeSelectionAccessibilityProps(false)).toEqual({});
  });
});
