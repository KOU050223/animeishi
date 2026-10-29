import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import { BackButton } from "./BackButton";

describe("BackButton", () => {
  it("button ロールと呼び出し側が渡したラベルを持つ", async () => {
    await render(<BackButton onPress={() => {}} accessibilityLabel="戻る" />);

    const button = screen.getByLabelText("戻る");
    expect(button.props.accessibilityRole).toBe("button");
  });

  it("押すと onPress が呼ばれる", async () => {
    const onPress = jest.fn();
    await render(<BackButton onPress={onPress} accessibilityLabel="戻る" />);

    await fireEvent.press(screen.getByLabelText("戻る"));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("押下領域は 44x44 以上を確保する", async () => {
    await render(
      <BackButton onPress={() => {}} accessibilityLabel="戻る" testID="back" />,
    );

    const style = StyleSheet.flatten(screen.getByTestId("back").props.style);
    expect(style.width).toBeGreaterThanOrEqual(44);
    expect(style.height).toBeGreaterThanOrEqual(44);
  });
});
