import { fireEvent, render, screen } from "@testing-library/react-native";
import { MenuPicker } from "./MenuPicker";

const renderPicker = (onValueChange = jest.fn()) =>
  render(
    <MenuPicker
      testID="test-menu"
      accessibilityLabel="年を選択"
      title="年を選択"
      closeAccessibilityLabel="年の選択を閉じる"
      selectedValue={2026}
      options={[
        { label: "2025年", value: 2025 },
        { label: "2026年", value: 2026 },
        { label: "2027年", value: 2027 },
      ]}
      onValueChange={onValueChange}
    />,
  );

describe("MenuPicker", () => {
  it("選択中の値のラベルをボタンに表示する", async () => {
    await renderPicker();
    expect(screen.getByText("2026年")).toBeTruthy();
  });

  it("ボタンを押すと選択肢が開き、選ぶと onValueChange が呼ばれて閉じる", async () => {
    const onValueChange = jest.fn();
    await renderPicker(onValueChange);

    await fireEvent.press(screen.getByTestId("test-menu-button"));
    await fireEvent.press(screen.getByTestId("test-menu-option-2025"));

    expect(onValueChange).toHaveBeenCalledWith(2025);
    expect(screen.queryByTestId("test-menu-option-2025")).toBeNull();
  });

  it("ボタンに呼び出し側の指定した testID・ラベルが付く", async () => {
    await renderPicker();
    expect(screen.getByTestId("test-menu-button")).toBeTruthy();
    expect(screen.getByLabelText("年を選択")).toBeTruthy();
  });
});
