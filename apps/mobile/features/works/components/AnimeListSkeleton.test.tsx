import { render } from "@testing-library/react-native";
import { AnimeListSkeleton } from "./AnimeListSkeleton";

describe("AnimeListSkeleton", () => {
  it("グリッドコンテナを busy な読み込み領域として出す", async () => {
    const { getByTestId } = await render(
      <AnimeListSkeleton cardWidth={300} contentWidth={600} numColumns={2} />,
    );
    const skeleton = getByTestId("anime-list-skeleton");
    expect(skeleton.props.accessibilityState?.busy).toBe(true);
    expect(skeleton.props.accessibilityLabel).toBe("作品を読み込んでいます");
  });

  it("列数に応じた数のスケルトンカードを出す", async () => {
    const { getAllByTestId } = await render(
      <AnimeListSkeleton cardWidth={200} contentWidth={900} numColumns={4} />,
    );
    // numColumns * 3 = 12 枚
    expect(getAllByTestId("anime-list-skeleton-card")).toHaveLength(12);
  });

  it("1 列レイアウトでも最低件数を確保する", async () => {
    const { getAllByTestId } = await render(
      <AnimeListSkeleton cardWidth={340} contentWidth={340} numColumns={1} />,
    );
    expect(getAllByTestId("anime-list-skeleton-card")).toHaveLength(6);
  });
});
