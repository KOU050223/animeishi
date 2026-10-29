import { render, screen } from "@testing-library/react-native";
import { useColorScheme } from "react-native";
import { Input } from "./Input";
import { colors } from "@/lib/theme";

// @react-native/jest-preset が useColorScheme を jest.fn(() => "light")
// でモック済みのため、mockReturnValue でスキームを切り替える。
const mockUseColorScheme = jest.mocked(useColorScheme);

const setScheme = (colorScheme: "light" | "dark") =>
  mockUseColorScheme.mockReturnValue(colorScheme);

describe("Input", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    setScheme("light");
  });

  it("プレースホルダー色に light トークンを適用する", async () => {
    await render(<Input placeholder="名前" testID="input" />);
    expect(screen.getByTestId("input").props.placeholderTextColor).toBe(
      colors.light.placeholder,
    );
  });

  it("ダークスキームでは dark トークンを適用する", async () => {
    setScheme("dark");
    await render(<Input placeholder="名前" testID="input" />);
    expect(screen.getByTestId("input").props.placeholderTextColor).toBe(
      colors.dark.placeholder,
    );
  });

  it("明示した placeholderTextColor を優先する", async () => {
    await render(<Input testID="input" placeholderTextColor="#123456" />);
    expect(screen.getByTestId("input").props.placeholderTextColor).toBe(
      "#123456",
    );
  });

  it("value / onChangeText などの props をそのまま TextInput に渡す", async () => {
    const onChangeText = jest.fn();
    await render(
      <Input
        testID="input"
        value="abc"
        onChangeText={onChangeText}
        accessibilityLabel="検索"
      />,
    );
    const input = screen.getByTestId("input");
    expect(input.props.value).toBe("abc");
    input.props.onChangeText("xyz");
    expect(onChangeText).toHaveBeenCalledWith("xyz");
  });
});
