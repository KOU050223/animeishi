import { fireEvent, render } from "@testing-library/react-native";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { TierBoard } from "./TierBoard";
import type { TierAssignment, TierRow, TierWork } from "@/lib/tierList/types";

// DraggableWorkCard のジェスチャ（RNGH / Reanimated）はテストで再現できないため、
// ドラッグ開始を press、ドラッグ終了を longPress、キャンセルを touchCancel に
// 写像したスタブに差し替える。
jest.mock("./DraggableWorkCard", () => {
  const { Pressable, Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    DraggableWorkCard: ({
      work,
      onDragStart,
      onDragEnd,
      onDragCancel,
    }: {
      work: TierWork;
      onDragStart: () => void;
      onDragEnd: (x: number, y: number) => void;
      onDragCancel: () => void;
    }) => (
      <Pressable
        testID={`tier-card-${work.annictWorkId}`}
        onPress={onDragStart}
        onLongPress={() => onDragEnd(0, 0)}
        onTouchCancel={onDragCancel}
      >
        <Text>{work.title}</Text>
      </Pressable>
    ),
  };
});

const TIERS: TierRow[] = [
  { key: "0", label: "S", color: "#ff0000" },
  { key: "1", label: "A", color: "#ff8000" },
];

const WORKS: TierWork[] = [
  { annictWorkId: 1, title: "作品1" },
  { annictWorkId: 2, title: "作品2" },
  { annictWorkId: 3, title: "作品3" },
];
// 作品1 → tier "0"、作品2 → tier "1"、作品3 は未分類トレイ
const ASSIGNMENT: TierAssignment = new Map([
  [1, "0"],
  [2, "1"],
]);

// works の既定値を空にしているのは、DraggableWorkCard（reanimated /
// gesture-handler のスタブ）をテスト対象に含めないため。
// ラベル編集の振る舞いは作品カードに依存しない。
const boardElement = (
  props: {
    labelsEditable?: boolean;
    onRenameTier?: jest.Mock;
    works?: TierWork[];
    assignment?: TierAssignment;
  } = {},
) => (
  <TierBoard
    tiers={TIERS}
    works={props.works ?? []}
    assignment={props.assignment ?? new Map()}
    onAssign={jest.fn()}
    onRenameTier={props.onRenameTier ?? jest.fn()}
    labelsEditable={props.labelsEditable ?? true}
  />
);

const zIndexOf = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(el.props.style as StyleProp<ViewStyle>)?.zIndex;

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

describe("ドラッグ中カードの重なり順", () => {
  it("tier 内のカードをドラッグ中は、その行と盤面が最前面になる", () => {
    const { getByTestId } = render(
      boardElement({ works: WORKS, assignment: ASSIGNMENT }),
    );

    fireEvent.press(getByTestId("tier-card-1"));

    // 下段の行より手前に出すため、ドラッグ中カードを含む行自体を持ち上げる。
    // カード自身の zIndex だけでは、後に描画される別の行（特に Web は全 View が
    // stacking context を持つ）や未分類トレイの下に潜ってしまうため。
    expect(zIndexOf(getByTestId("tier-row-0"))).toBeGreaterThan(0);
    // ドラッグしていない行は持ち上げない
    expect(zIndexOf(getByTestId("tier-row-1")) ?? 0).toBe(0);
    // 盤面より後に描画される未分類トレイの下に潜らないよう、盤面も持ち上げる
    expect(zIndexOf(getByTestId("tier-board"))).toBeGreaterThan(0);
  });

  it("未分類トレイのカードをドラッグ中は、トレイが最前面になる", () => {
    const { getByTestId } = render(
      boardElement({ works: WORKS, assignment: ASSIGNMENT }),
    );

    fireEvent.press(getByTestId("tier-card-3"));

    expect(zIndexOf(getByTestId("tier-tray"))).toBeGreaterThan(0);
  });

  it("ドラッグがキャンセルされても元の重なり順に戻る", () => {
    const { getByTestId } = render(
      boardElement({ works: WORKS, assignment: ASSIGNMENT }),
    );

    const card = getByTestId("tier-card-1");
    fireEvent.press(card);
    // onEnd を通らないキャンセル（別ジェスチャに奪われた等）を再現する
    fireEvent(card, "touchCancel");

    expect(zIndexOf(getByTestId("tier-row-0")) ?? 0).toBe(0);
    expect(zIndexOf(getByTestId("tier-board")) ?? 0).toBe(0);
  });

  it("ドラッグ終了後は元の重なり順に戻る", () => {
    const { getByTestId } = render(
      boardElement({ works: WORKS, assignment: ASSIGNMENT }),
    );

    const card = getByTestId("tier-card-1");
    fireEvent.press(card);
    fireEvent(card, "longPress");

    expect(zIndexOf(getByTestId("tier-row-0")) ?? 0).toBe(0);
    expect(zIndexOf(getByTestId("tier-board")) ?? 0).toBe(0);
  });
});
