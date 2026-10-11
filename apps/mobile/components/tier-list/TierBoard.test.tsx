import { fireEvent, render } from "@testing-library/react-native";
import { TierBoard } from "./TierBoard";
import type { TierRow } from "@/lib/tierList/types";

const TIERS: TierRow[] = [
  { key: "0", label: "S", color: "#ff0000" },
  { key: "1", label: "A", color: "#ff8000" },
];

// works を空にしているのは、DraggableWorkCard（reanimated / gesture-handler）
// をテスト対象に含めないため。ラベル編集の振る舞いは作品カードに依存しない。
const boardElement = (
  props: { labelsEditable?: boolean; onRenameTier?: jest.Mock } = {},
) => (
  <TierBoard
    tiers={TIERS}
    works={[]}
    assignment={new Map()}
    onAssign={jest.fn()}
    onRenameTier={props.onRenameTier ?? jest.fn()}
    labelsEditable={props.labelsEditable ?? true}
  />
);

describe("TierBoard の tier 名編集", () => {
  it("ラベルをタップすると編集シートが開く", () => {
    const { getByTestId } = render(boardElement());
    fireEvent.press(getByTestId("tier-label-0"));
    expect(getByTestId("tier-label-input")).toBeTruthy();
  });

  it("シートで確定すると onRenameTier が呼ばれる", () => {
    const onRenameTier = jest.fn();
    const { getByTestId } = render(boardElement({ onRenameTier }));

    fireEvent.press(getByTestId("tier-label-1"));
    fireEvent.changeText(getByTestId("tier-label-input"), "神");
    fireEvent.press(getByTestId("tier-label-submit"));

    expect(onRenameTier).toHaveBeenCalledWith("1", "神");
  });

  it("labelsEditable=false の間はラベルをタップしてもシートが開かない", () => {
    const { getByTestId, queryByTestId } = render(
      boardElement({ labelsEditable: false }),
    );
    fireEvent.press(getByTestId("tier-label-0"));
    expect(queryByTestId("tier-label-input")).toBeNull();
  });

  it("編集中に labelsEditable が false になると開いているシートも閉じる", () => {
    const { getByTestId, queryByTestId, rerender } = render(boardElement());
    fireEvent.press(getByTestId("tier-label-0"));
    expect(getByTestId("tier-label-input")).toBeTruthy();

    rerender(boardElement({ labelsEditable: false }));
    expect(queryByTestId("tier-label-input")).toBeNull();
  });
});
