import { render, screen } from "@testing-library/react-native";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";

const NAMES: IconName[] = [
  "id-card-outline",
  "qr-code-outline",
  "chatbubble-ellipses-outline",
];

// Web でアイコンフォントの読み込みに失敗しても消えないよう、
// フォントではなく SVG で描画する（issue #519）。
describe("Icon", () => {
  it.each(NAMES)("%s を描画する", async (name) => {
    const { toJSON } = await render(<Icon name={name} color="#000" />);
    expect(JSON.stringify(toJSON())).toContain("RNSVGSvgView");
  });

  it("size と color を SVG に反映する", async () => {
    await render(
      <Icon name="qr-code-outline" size={32} color="#123456" testID="icon" />,
    );
    const svg = screen.getByTestId("icon");
    expect(svg.props.width).toBe(32);
    expect(svg.props.fill).toBe("#123456");
  });
});
