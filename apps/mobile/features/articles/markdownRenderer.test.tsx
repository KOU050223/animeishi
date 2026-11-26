import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import { useMarkdown } from "react-native-marked";
import { AccessibleLinkRenderer } from "@/features/articles/markdownRenderer";

function Markdown({ body }: { body: string }) {
  const elements = useMarkdown(body, {
    renderer: new AccessibleLinkRenderer(),
  });
  return <>{elements}</>;
}

describe("AccessibleLinkRenderer", () => {
  // 既定の Renderer は accessibilityLabel="Link" を付け、Web では
  // aria-label になってリンクテキストが読めなくなる（issue #607）。
  it("リンクに accessibilityLabel を付けず、リンクテキストがそのまま見える", async () => {
    await render(
      <Markdown body="会場へは[アクセス](https://example.com/access)を見てください" />,
    );
    const link = screen.getByRole("link");
    expect(link.props.accessibilityLabel).toBeUndefined();
    expect(screen.getByText("アクセス")).toBeTruthy();
  });

  it("リンクを押すと Linking.openURL で開く", async () => {
    const openURL = jest
      .spyOn(Linking, "openURL")
      .mockResolvedValue(true as never);
    await render(<Markdown body="[公式サイト](https://example.com/)" />);
    await fireEvent.press(screen.getByRole("link"));
    expect(openURL).toHaveBeenCalledWith("https://example.com/");
    openURL.mockRestore();
  });
});
