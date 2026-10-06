import { render } from "@testing-library/react-native";
import { Image } from "react-native";
import { TierBoardSnapshot } from "./TierBoardSnapshot";

const TIERS = [
  { key: "s", label: "S", color: "#ff7f7f" },
  { key: "a", label: "A", color: "#ffbf7f" },
];

const ITEMS = [
  { annictWorkId: 1, tierKey: "s", title: "作品A" },
  { annictWorkId: 2, tierKey: "a", title: "作品B" },
  { annictWorkId: 3, tierKey: "s", title: "作品C" },
];

const ITEMS_WITH_IMAGES = [
  {
    annictWorkId: 1,
    tierKey: "s",
    title: "作品A",
    imageUrl: "https://example.com/a.png",
  },
  {
    annictWorkId: 2,
    tierKey: "a",
    title: "作品B",
    imageUrl: "https://example.com/b.png",
  },
];

describe("TierBoardSnapshot", () => {
  it("タイトルと各 tier のラベル・作品を表示する", () => {
    const { getByText } = render(
      <TierBoardSnapshot title="2026春のTier表" tiers={TIERS} items={ITEMS} />,
    );

    expect(getByText("2026春のTier表")).toBeTruthy();
    expect(getByText("S")).toBeTruthy();
    expect(getByText("A")).toBeTruthy();
    expect(getByText("作品A")).toBeTruthy();
    expect(getByText("作品B")).toBeTruthy();
    expect(getByText("作品C")).toBeTruthy();
  });

  it("未分類の作品は描画しない", () => {
    const { queryByText } = render(
      <TierBoardSnapshot
        title="t"
        tiers={TIERS}
        items={[{ annictWorkId: 9, tierKey: "zzz", title: "幽霊作品" }]}
      />,
    );

    expect(queryByText("幽霊作品")).toBeNull();
  });

  describe("onReady", () => {
    it("画像が無い表はマウント直後に onReady を呼ぶ", () => {
      const onReady = jest.fn();
      render(
        <TierBoardSnapshot
          title="t"
          tiers={TIERS}
          items={ITEMS}
          onReady={onReady}
        />,
      );
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it("全画像の読み込み（onLoadEnd）が終わるまで onReady を呼ばない", () => {
      const onReady = jest.fn();
      const { UNSAFE_getAllByType } = render(
        <TierBoardSnapshot
          title="t"
          tiers={TIERS}
          items={ITEMS_WITH_IMAGES}
          onReady={onReady}
        />,
      );

      expect(onReady).not.toHaveBeenCalled();

      const images = UNSAFE_getAllByType(Image);
      expect(images).toHaveLength(2);

      // 1 枚目の完了ではまだ呼ばれない
      images[0].props.onLoadEnd();
      expect(onReady).not.toHaveBeenCalled();

      // 全件完了で一度だけ呼ばれる（読み込み失敗でも onLoadEnd は来る）
      images[1].props.onLoadEnd();
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it("tiers に無い tierKey の画像付き作品は読み込み待ちに含めない", () => {
      // 描画されない画像は onLoadEnd が来ない。読み込み待ち対象に数えると
      // onReady が永久に発火せずキャプチャがタイムアウト待ちになる。
      const onReady = jest.fn();
      render(
        <TierBoardSnapshot
          title="t"
          tiers={TIERS}
          items={[
            {
              annictWorkId: 9,
              tierKey: "zzz",
              title: "幽霊作品",
              imageUrl: "https://example.com/ghost.png",
            },
          ]}
          onReady={onReady}
        />,
      );
      expect(onReady).toHaveBeenCalledTimes(1);
    });
  });
});
