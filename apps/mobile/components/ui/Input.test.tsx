import { render, screen } from "@testing-library/react-native";
import { useColorScheme } from "nativewind";
import { Input } from "./Input";
import { colors } from "@/lib/theme";

jest.mock("nativewind", () => ({
  useColorScheme: jest.fn(() => ({
    colorScheme: "light",
    setColorScheme: jest.fn(),
    toggleColorScheme: jest.fn(),
  })),
}));

const mockUseColorScheme = jest.mocked(useColorScheme);

const setScheme = (colorScheme: "light" | "dark") =>
  mockUseColorScheme.mockReturnValue({
    colorScheme,
    setColorScheme: jest.fn(),
    toggleColorScheme: jest.fn(),
  });

describe("Input", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setScheme("light");
  });

  it("プレースホルダー色に light トークンを適用する", () => {
    render(<Input placeholder="名前" testID="input" />);
    expect(screen.getByTestId("input").props.placeholderTextColor).toBe(
      colors.light.placeholder,
    );
  });

  it("ダークスキームでは dark トークンを適用する", () => {
    setScheme("dark");
    render(<Input placeholder="名前" testID="input" />);
    expect(screen.getByTestId("input").props.placeholderTextColor).toBe(
      colors.dark.placeholder,
    );
  });

  it("明示した placeholderTextColor を優先する", () => {
    render(<Input testID="input" placeholderTextColor="#123456" />);
    expect(screen.getByTestId("input").props.placeholderTextColor).toBe(
      "#123456",
    );
  });

  it("value / onChangeText などの props をそのまま TextInput に渡す", () => {
    const onChangeText = jest.fn();
    render(
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
