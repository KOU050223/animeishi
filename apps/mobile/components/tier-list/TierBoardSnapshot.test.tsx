import { render } from "@testing-library/react-native";
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
});
