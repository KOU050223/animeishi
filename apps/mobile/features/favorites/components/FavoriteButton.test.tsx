import { render, screen } from "@testing-library/react-native";
import { FavoriteButton } from "./FavoriteButton";

describe("FavoriteButton", () => {
  it.each([
    ["未登録", false],
    ["登録済み", true],
  ])(
    "%sでもトグルボタンの読み上げ名は固定される",
    async (_label, isFavorite) => {
      await render(
        <FavoriteButton
          isFavorite={isFavorite}
          disabled={false}
          onPress={jest.fn()}
          title="テスト作品"
        />,
      );

      const button = screen.getByLabelText("テスト作品の推し登録を切り替える");
      expect(button.props.accessibilityState).toMatchObject({
        selected: isFavorite,
        disabled: false,
      });
    },
  );
});
