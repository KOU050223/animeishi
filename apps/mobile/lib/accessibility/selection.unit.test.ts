import { describe, expect, it } from "vitest";
import {
  currentAccessibilityProps as nativeCurrentAccessibilityProps,
  selectionAccessibilityProps as nativeSelectionAccessibilityProps,
} from "./selection.native";
import {
  currentAccessibilityProps as webCurrentAccessibilityProps,
  selectionAccessibilityProps as webSelectionAccessibilityProps,
} from "./selection.web";

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

describe("currentAccessibilityProps", () => {
  it("Web では現在値を aria-current として返す", () => {
    expect(webCurrentAccessibilityProps(true)).toEqual({
      "aria-current": true,
    });
    expect(webCurrentAccessibilityProps(false)).toEqual({
      "aria-current": false,
    });
  });

  it("ネイティブでは accessibilityState に任せて追加属性を返さない", () => {
    expect(nativeCurrentAccessibilityProps(true)).toEqual({});
    expect(nativeCurrentAccessibilityProps(false)).toEqual({});
  });
});
