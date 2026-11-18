import { describe, expect, it } from "vitest";
import { getInspectorHeight } from "./inspectorLayout";

describe("getInspectorHeight", () => {
  it("高さ568ptの画面ではキャンバス用に従来の高さを残す", () => {
    expect(getInspectorHeight(568)).toBe(236);
  });

  it("大きい画面では設定欄を広く表示する", () => {
    expect(getInspectorHeight(800)).toBe(384);
  });
});
