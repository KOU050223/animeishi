import { fireEvent, render, screen } from "@testing-library/react-native";
import { Button } from "./Button";
import { colors } from "@/lib/theme";

// RNTL 14 では UNSAFE_getByType が無いため queryAll でホスト要素を探す
// （WorkThumbnail.test.tsx と同じ手法）。
const findIndicators = () =>
  screen.container.queryAll(
    (node) =>
      typeof node.type === "string" && node.type.includes("ActivityIndicator"),
  );

describe("Button", () => {
  it("label を表示し、押下で onPress を呼ぶ", async () => {
    const onPress = jest.fn();
    await render(<Button label="保存" onPress={onPress} testID="button" />);

    expect(screen.getByText("保存")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("disabled のとき onPress を呼ばない", async () => {
    const onPress = jest.fn();
    await render(
      <Button label="保存" onPress={onPress} disabled testID="button" />,
    );

    await fireEvent.press(screen.getByTestId("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("loading 中はラベルの代わりにインジケータを出しタップを無効化する", async () => {
    const onPress = jest.fn();
    await render(
      <Button label="保存" onPress={onPress} loading testID="button" />,
    );

    expect(screen.queryByText("保存")).toBeNull();
    expect(findIndicators()).toHaveLength(1);
    await fireEvent.press(screen.getByTestId("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("primary のインジケータ色は onPrimary", async () => {
    await render(<Button label="保存" onPress={jest.fn()} loading />);
    expect(findIndicators()[0].props.color).toBe(colors.light.onPrimary);
  });

  it("destructive のインジケータ色は danger", async () => {
    await render(
      <Button label="削除" onPress={jest.fn()} variant="destructive" loading />,
    );
    expect(findIndicators()[0].props.color).toBe(colors.light.danger);
  });
});
