import { fireEvent, render } from "@testing-library/react-native";
import {
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useColorScheme } from "nativewind";
import { TierBoard } from "./TierBoard";
import { colors } from "@/lib/theme";
import type { TierAssignment, TierRow, TierItem } from "@/lib/tierList/types";

// jest.setup.js のグローバルモックと同じ形で、スキームを個別に切り替えられるよう
// このファイル内では再モックする。
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

// DraggableWorkCard のジェスチャ（RNGH / Reanimated）はテストで再現できないため、
// ドラッグ開始を press、ドラッグ終了を longPress、キャンセルを touchCancel に
// 写像したスタブに差し替える。
jest.mock("./DraggableWorkCard", () => {
  const { Pressable, Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    DraggableWorkCard: ({
      item,
      onDragStart,
      onDragEnd,
      onDragCancel,
    }: {
      item: TierItem;
      onDragStart: () => void;
      onDragEnd: (x: number, y: number) => void;
      onDragCancel: () => void;
    }) => (
      <Pressable
        testID={`tier-card-${item.id}`}
        onPress={onDragStart}
        onLongPress={() => onDragEnd(0, 0)}
        onTouchCancel={onDragCancel}
      >
        <Text>{item.title}</Text>
      </Pressable>
    ),
  };
});

// WorkAddSheet 内部の検索フック（API / Annict 連携）は別のテストで検証するため、
// シートは「開いているときだけ visible マーカーを出し、onAdd を直通する」
// スタブに差し替える。
jest.mock("./WorkAddSheet", () => {
  const { Pressable, Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    WorkAddSheet: ({
      visible,
      onAdd,
      onClose,
    }: {
      visible: boolean;
      onAdd: (item: TierItem) => void;
      onClose: () => void;
    }) =>
      visible ? (
        <Pressable
          testID="work-add-sheet"
          onPress={() => onAdd({ id: 99, title: "追加作品" })}
          onLongPress={onClose}
        >
          <Text>sheet</Text>
        </Pressable>
      ) : null,
  };
});

const TIERS: TierRow[] = [
  { key: "0", label: "S", color: "#ff0000" },
  { key: "1", label: "A", color: "#ff8000" },
];

const ITEMS: TierItem[] = [
  { id: 1, title: "作品1" },
  { id: 2, title: "作品2" },
  { id: 3, title: "作品3" },
];
// 作品1 → tier "0"、作品2 → tier "1"、作品3 は未分類トレイ
const ASSIGNMENT: TierAssignment = new Map([
  [1, "0"],
  [2, "1"],
]);

// items の既定値を空にしているのは、DraggableWorkCard（reanimated /
// gesture-handler のスタブ）をテスト対象に含めないため。
// ラベル編集の振る舞いはカードに依存しない。
const boardElement = (
  props: {
    labelsEditable?: boolean;
    onRenameTier?: jest.Mock;
    onAddItem?: jest.Mock;
    items?: TierItem[];
    assignment?: TierAssignment;
  } = {},
) => (
  <TierBoard
    tiers={TIERS}
    items={props.items ?? []}
    assignment={props.assignment ?? new Map()}
    onAssign={jest.fn()}
    onRenameTier={props.onRenameTier ?? jest.fn()}
    onAddItem={props.onAddItem ?? jest.fn()}
    labelsEditable={props.labelsEditable ?? true}
    trayEmptyLabel="すべて配置しました"
  />
);

const zIndexOf = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(el.props.style as StyleProp<ViewStyle>)?.zIndex;

const backgroundColorOf = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(el.props.style as StyleProp<ViewStyle>)?.backgroundColor;

// スキームを切り替えたテストが後続へ漏れないよう、各テストの前に light へ戻す。
beforeEach(() => {
  setScheme("light");
});

describe("TierBoard の配色", () => {
  it("light スキームでは未分類トレイを白系の面で描く", () => {
    const { getByTestId } = render(boardElement());
    expect(backgroundColorOf(getByTestId("tier-tray"))).toBe(
      colors.light.tierDropArea,
    );
  });

  it("dark スキームでは未分類トレイを暗色の面で描く", () => {
    setScheme("dark");
    const { getByTestId } = render(boardElement());
    expect(backgroundColorOf(getByTestId("tier-tray"))).toBe(
      colors.dark.tierDropArea,
    );
  });

  it("tier ラベルの文字色は行の背景色とのコントラストで決まる", () => {
    // TIERS の 0 番は #ff0000（白文字側）、1 番は #ff8000（濃色文字側）。
    const { getByTestId } = render(boardElement());
    const labelTextColor = (testId: string) =>
      StyleSheet.flatten(
        getByTestId(testId).findByProps({ numberOfLines: 3 }).props
          .style as StyleProp<TextStyle>,
      )?.color;
    expect(labelTextColor("tier-label-0")).toBe("#ffffff");
    expect(labelTextColor("tier-label-1")).toBe("#1f2937");
  });
});

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

describe("TierBoard の作品手動追加", () => {
  it("未分類の＋ボタンをタップすると検索シートが開く", () => {
    const { getByTestId, queryByTestId } = render(boardElement());
    expect(queryByTestId("work-add-sheet")).toBeNull();

    fireEvent.press(getByTestId("tier-tray-add"));
    expect(queryByTestId("work-add-sheet")).toBeTruthy();
  });

  it("シートで作品が選ばれると onAddItem に渡る", () => {
    const onAddItem = jest.fn();
    const { getByTestId } = render(boardElement({ onAddItem }));

    fireEvent.press(getByTestId("tier-tray-add"));
    fireEvent.press(getByTestId("work-add-sheet"));

    expect(onAddItem).toHaveBeenCalledWith({
      id: 99,
      title: "追加作品",
    });
  });

  it("labelsEditable=false の間は＋ボタンが無効でシートが開かない", () => {
    const { getByTestId, queryByTestId } = render(
      boardElement({ labelsEditable: false }),
    );
    fireEvent.press(getByTestId("tier-tray-add"));
    expect(queryByTestId("work-add-sheet")).toBeNull();
  });

  it("シート表示中に labelsEditable が false になるとシートが閉じる", () => {
    const { getByTestId, queryByTestId, rerender } = render(boardElement());
    fireEvent.press(getByTestId("tier-tray-add"));
    expect(queryByTestId("work-add-sheet")).toBeTruthy();

    rerender(boardElement({ labelsEditable: false }));
    expect(queryByTestId("work-add-sheet")).toBeNull();
  });
});

describe("ドラッグ中カードの重なり順", () => {
  it("tier 内のカードをドラッグ中は、その行と盤面が最前面になる", () => {
    const { getByTestId } = render(
      boardElement({ items: ITEMS, assignment: ASSIGNMENT }),
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
      boardElement({ items: ITEMS, assignment: ASSIGNMENT }),
    );

    fireEvent.press(getByTestId("tier-card-3"));

    expect(zIndexOf(getByTestId("tier-tray"))).toBeGreaterThan(0);
  });

  it("ドラッグがキャンセルされても元の重なり順に戻る", () => {
    const { getByTestId } = render(
      boardElement({ items: ITEMS, assignment: ASSIGNMENT }),
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
      boardElement({ items: ITEMS, assignment: ASSIGNMENT }),
    );

    const card = getByTestId("tier-card-1");
    fireEvent.press(card);
    fireEvent(card, "longPress");

    expect(zIndexOf(getByTestId("tier-row-0")) ?? 0).toBe(0);
    expect(zIndexOf(getByTestId("tier-board")) ?? 0).toBe(0);
  });
});
