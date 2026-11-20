import { describe, expect, it, vi } from "vitest";
import * as ExpoHaptics from "expo-haptics";
import { haptics as hapticsIos } from "./haptics.ios";
import { haptics as hapticsFallback } from "./haptics";

vi.mock("expo-haptics", () => ({
  notificationAsync: vi.fn(),
  selectionAsync: vi.fn(),
  impactAsync: vi.fn(),
  NotificationFeedbackType: { Success: "success", Warning: "warning" },
  ImpactFeedbackStyle: { Light: "light", Medium: "medium", Heavy: "heavy" },
}));

describe("haptics.ios", () => {
  it("success は notificationAsync(Success) を呼ぶ", () => {
    hapticsIos.success();
    expect(ExpoHaptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("warning は notificationAsync(Warning) を呼ぶ", () => {
    hapticsIos.warning();
    expect(ExpoHaptics.notificationAsync).toHaveBeenCalledWith("warning");
  });

  it("selection は selectionAsync を呼ぶ", () => {
    hapticsIos.selection();
    expect(ExpoHaptics.selectionAsync).toHaveBeenCalledTimes(1);
  });

  it("impactLight は impactAsync(Light) を呼ぶ", () => {
    hapticsIos.impactLight();
    expect(ExpoHaptics.impactAsync).toHaveBeenCalledWith("light");
  });

  it("impactMedium は impactAsync(Medium) を呼ぶ", () => {
    hapticsIos.impactMedium();
    expect(ExpoHaptics.impactAsync).toHaveBeenCalledWith("medium");
  });

  it("impactHeavy は impactAsync(Heavy) を呼ぶ", () => {
    hapticsIos.impactHeavy();
    expect(ExpoHaptics.impactAsync).toHaveBeenCalledWith("heavy");
  });
});

describe("haptics (Android/Web フォールバック)", () => {
  it("全操作が no-op で例外を投げない", () => {
    expect(() => {
      hapticsFallback.success();
      hapticsFallback.warning();
      hapticsFallback.selection();
      hapticsFallback.impactLight();
      hapticsFallback.impactMedium();
      hapticsFallback.impactHeavy();
    }).not.toThrow();
  });

  it("expo-haptics を呼ばない", () => {
    hapticsFallback.success();
    hapticsFallback.selection();
    expect(ExpoHaptics.notificationAsync).not.toHaveBeenCalled();
    expect(ExpoHaptics.selectionAsync).not.toHaveBeenCalled();
  });
});
