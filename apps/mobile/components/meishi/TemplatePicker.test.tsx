import { render, screen } from "@testing-library/react-native";
import { TemplatePicker } from "./TemplatePicker";

describe("TemplatePicker", () => {
  it("配色を比較できる色見本を表示する", async () => {
    await render(
      <TemplatePicker visible onClose={jest.fn()} onPick={jest.fn()} />,
    );

    expect(screen.getByTestId("template-swatch-sunset-start")).toHaveStyle({
      backgroundColor: "#ff9a56",
    });
    expect(screen.getByTestId("template-swatch-sunset-end")).toHaveStyle({
      backgroundColor: "#ff5f6d",
    });
    expect(screen.getByTestId("template-swatch-midnight-start")).toHaveStyle({
      backgroundColor: "#0f172a",
    });
    expect(screen.getByTestId("template-swatch-sakura-end")).toHaveStyle({
      backgroundColor: "#fbcfe8",
    });
  });
});
