import React from "react";
import { render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import * as Reanimated from "react-native-reanimated";
import { colors } from "@/lib/theme/colors";
import { Skeleton, SkeletonGroup } from "./Skeleton";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Skeleton", () => {
  it("骨はテーマの skeleton 色で描く", async () => {
    const { getByTestId } = await render(
      <Skeleton className="h-3 w-10 rounded" testID="bone" />,
    );
    const style = StyleSheet.flatten(getByTestId("bone").props.style) as {
      backgroundColor?: string;
    };
    expect(style.backgroundColor).toBe(colors.light.skeleton);
  });

  it("muted の骨は一段薄い skeletonMuted 色で描く", async () => {
    const { getByTestId } = await render(
      <Skeleton className="h-3 w-10 rounded" muted testID="bone" />,
    );
    const style = StyleSheet.flatten(getByTestId("bone").props.style) as {
      backgroundColor?: string;
    };
    expect(style.backgroundColor).toBe(colors.light.skeletonMuted);
  });
});

describe("SkeletonGroup", () => {
  it("ラベルを渡すと領域全体が 1 つの busy な読み込み要素になる", async () => {
    await render(
      <SkeletonGroup accessibilityLabel="読み込み中" testID="group">
        <Skeleton className="h-3 w-10 rounded" testID="bone" />
      </SkeletonGroup>,
    );

    // 「読み込み中」は領域の 1 回だけ読み上げる（骨は対象外）
    expect(screen.getAllByLabelText("読み込み中")).toHaveLength(1);
    const group = screen.getByTestId("group");
    expect(group.props.accessible).toBe(true);
    expect(group.props.accessibilityState?.busy).toBe(true);
    expect(screen.getByTestId("bone").props.accessibilityLabel).toBeUndefined();
  });

  it("ラベル無しの領域は読み上げ対象にしない", async () => {
    await render(
      <SkeletonGroup testID="group">
        <Skeleton className="h-3 w-10 rounded" testID="bone" />
      </SkeletonGroup>,
    );

    const group = screen.getByTestId("group");
    expect(group.props.accessible).toBeFalsy();
    expect(group.props.accessibilityLabel).toBeUndefined();
  });

  it("reduce motion 設定時はパルスアニメーションを開始しない", async () => {
    jest.spyOn(Reanimated, "useReducedMotion").mockReturnValue(true);
    const withRepeat = jest.spyOn(Reanimated, "withRepeat");

    await render(
      <SkeletonGroup testID="group">
        <Skeleton className="h-3 w-10 rounded" />
      </SkeletonGroup>,
    );

    expect(withRepeat).not.toHaveBeenCalled();
  });

  it("通常時はパルスアニメーションを開始する", async () => {
    const withRepeat = jest.spyOn(Reanimated, "withRepeat");

    await render(
      <SkeletonGroup testID="group">
        <Skeleton className="h-3 w-10 rounded" />
      </SkeletonGroup>,
    );

    expect(withRepeat).toHaveBeenCalled();
  });
});
