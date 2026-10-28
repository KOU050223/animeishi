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
// longPress で報告する指位置はテストごとに変えられるよう mockDropPoint 経由にし、
// 行内カードにだけ渡される矩形レジストリは mockCardRegistry に退避して、
// 実機では measureInWindow が行う矩形登録をテスト側から直接行えるようにする。
let mockDropPoint = { x: 0, y: 0 };
let mockCardRegistry: import("./dropZones").DropZoneRegistry | undefined;
jest.mock("./DraggableWorkCard", () => {
  const { Pressable, Text } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    DraggableWorkCard: ({
      item,
      onDragStart,
      onDragEnd,
      onDragCancel,
      registry,
    }: {
      item: TierItem;
      onDragStart: () => void;
      onDragEnd: (x: number, y: number) => void;
      onDragCancel: () => void;
      registry?: import("./dropZones").DropZoneRegistry;
    }) => {
      if (registry) mockCardRegistry = registry;
      return (
        <Pressable
          testID={`tier-card-${item.id}`}
          onPress={onDragStart}
          onLongPress={() => onDragEnd(mockDropPoint.x, mockDropPoint.y)}
          onTouchCancel={onDragCancel}
        >
          <Text>{item.title}</Text>
        </Pressable>
      );
    },
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
    onAssign?: jest.Mock;
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
    onAssign={props.onAssign ?? jest.fn()}
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
beforeEach(async () => {
  setScheme("light");
});

describe("TierBoard の配色", () => {
  it("light スキームでは未分類トレイを白系の面で描く", async () => {
    const { getByTestId } = await render(boardElement());
    expect(backgroundColorOf(getByTestId("tier-tray"))).toBe(
      colors.light.tierDropArea,
    );
  });

  it("dark スキームでは未分類トレイを暗色の面で描く", async () => {
    setScheme("dark");
    const { getByTestId } = await render(boardElement());
    expect(backgroundColorOf(getByTestId("tier-tray"))).toBe(
      colors.dark.tierDropArea,
    );
  });

  it("tier ラベルの文字色は行の背景色とのコントラストで決まる", async () => {
    // TIERS の 0 番は #ff0000（白文字側）、1 番は #ff8000（濃色文字側）。
    const { getByTestId } = await render(boardElement());
    const labelTextColor = (testId: string) =>
      StyleSheet.flatten(
        getByTestId(testId).queryAll(
          (node) => node.props.numberOfLines === 3,
        )[0].props.style as StyleProp<TextStyle>,
      )?.color;
    expect(labelTextColor("tier-label-0")).toBe("#ffffff");
    expect(labelTextColor("tier-label-1")).toBe("#1f2937");
  });
});

describe("TierBoard の tier 名編集", () => {
  it("ラベルをタップすると編集シートが開く", async () => {
    const { getByTestId } = await render(boardElement());
    await fireEvent.press(getByTestId("tier-label-0"));
    expect(getByTestId("tier-label-input")).toBeTruthy();
  });

  it("シートで確定すると onRenameTier が呼ばれる", async () => {
    const onRenameTier = jest.fn();
    const { getByTestId } = await render(boardElement({ onRenameTier }));

    await fireEvent.press(getByTestId("tier-label-1"));
    await fireEvent.changeText(getByTestId("tier-label-input"), "神");
    await fireEvent.press(getByTestId("tier-label-submit"));

    expect(onRenameTier).toHaveBeenCalledWith("1", "神");
  });

  it("labelsEditable=false の間はラベルをタップしてもシートが開かない", async () => {
    const { getByTestId, queryByTestId } = await render(
      boardElement({ labelsEditable: false }),
    );
    await fireEvent.press(getByTestId("tier-label-0"));
    expect(queryByTestId("tier-label-input")).toBeNull();
  });

  it("編集中に labelsEditable が false になると開いているシートも閉じる", async () => {
    const { getByTestId, queryByTestId, rerender } =
      await render(boardElement());
    await fireEvent.press(getByTestId("tier-label-0"));
    expect(getByTestId("tier-label-input")).toBeTruthy();

    await rerender(boardElement({ labelsEditable: false }));
    expect(queryByTestId("tier-label-input")).toBeNull();
  });
});

describe("TierBoard の作品手動追加", () => {
  it("未分類の＋ボタンをタップすると検索シートが開く", async () => {
    const { getByTestId, queryByTestId } = await render(boardElement());
    expect(queryByTestId("work-add-sheet")).toBeNull();

    await fireEvent.press(getByTestId("tier-tray-add"));
    expect(queryByTestId("work-add-sheet")).toBeTruthy();
  });

  it("シートで作品が選ばれると onAddItem に渡る", async () => {
    const onAddItem = jest.fn();
    const { getByTestId } = await render(boardElement({ onAddItem }));

    await fireEvent.press(getByTestId("tier-tray-add"));
    await fireEvent.press(getByTestId("work-add-sheet"));

    expect(onAddItem).toHaveBeenCalledWith({
      id: 99,
      title: "追加作品",
    });
  });

  it("labelsEditable=false の間は＋ボタンが無効でシートが開かない", async () => {
    const { getByTestId, queryByTestId } = await render(
      boardElement({ labelsEditable: false }),
    );
    await fireEvent.press(getByTestId("tier-tray-add"));
    expect(queryByTestId("work-add-sheet")).toBeNull();
  });

  it("シート表示中に labelsEditable が false になるとシートが閉じる", async () => {
    const { getByTestId, queryByTestId, rerender } =
      await render(boardElement());
    await fireEvent.press(getByTestId("tier-tray-add"));
    expect(queryByTestId("work-add-sheet")).toBeTruthy();

    await rerender(boardElement({ labelsEditable: false }));
    expect(queryByTestId("work-add-sheet")).toBeNull();
  });
});

describe("行内の並べ替え（issue #218）", () => {
  // 行 "0" にカード 1,2,3（幅 60px、隙間 4px で横並び）、行 "1" は空、
  // 作品4 は未分類トレイ。実機では onLayout / measureInWindow が登録する
  // 行・カードの矩形を、テストでは直接レジストリへ登録する。
  const ROW_ASSIGNMENT: TierAssignment = new Map([
    [1, "0"],
    [2, "0"],
    [3, "0"],
  ]);
  const BOARD_ITEMS: TierItem[] = [...ITEMS, { id: 4, title: "作品4" }];

  function setupDropGeometry() {
    const registry = mockCardRegistry;
    if (!registry) throw new Error("registry がカードから渡されていません");
    registry.register("0", { x: 0, y: 0, width: 300, height: 130 });
    registry.register("1", { x: 0, y: 130, width: 300, height: 130 });
    registry.register(null, { x: 0, y: 260, width: 300, height: 130 });
    registry.registerCard(1, { x: 0, y: 4, width: 60, height: 116 });
    registry.registerCard(2, { x: 64, y: 4, width: 60, height: 116 });
    registry.registerCard(3, { x: 128, y: 4, width: 60, height: 116 });
  }

  async function renderDropBoard(onAssign = jest.fn()) {
    const utils = await render(
      boardElement({
        items: BOARD_ITEMS,
        assignment: ROW_ASSIGNMENT,
        onAssign,
      }),
    );
    return { ...utils, onAssign };
  }

  const dropAt = (x: number, y: number) => {
    mockDropPoint = { x, y };
  };

  it("同じ行の別カードの前半に落とすと、そのカードの直前に挿入される", async () => {
    const { getByTestId, onAssign } = await renderDropBoard();
    const card = getByTestId("tier-card-3");
    await fireEvent.press(card);
    setupDropGeometry();
    // カード1（x 0-60、中央 30）の前半に落とす
    dropAt(10, 50);
    await fireEvent(card, "longPress");

    expect(onAssign).toHaveBeenCalledWith(3, "0", 1);
  });

  it("直後のカードの前半に落とすなど、順序が変わらないドロップでは onAssign を呼ばない", async () => {
    // 順序 [1,2,3] でカード1 をカード2 の前半に落としても [1,2,3] のまま。
    // onAssign まで通すと配置は変わらないのに未保存フラグだけが立つ。
    const { getByTestId, onAssign } = await renderDropBoard();
    const card = getByTestId("tier-card-1");
    await fireEvent.press(card);
    setupDropGeometry();
    dropAt(80, 50); // カード2 の前半
    await fireEvent(card, "longPress");

    expect(onAssign).not.toHaveBeenCalled();
  });

  it("末尾のカードを直前のカードの後半に落としても配置は変わらない", async () => {
    // 順序 [1,2,3] でカード3 をカード2 の後半に落とすと挿入アンカーは
    // カード3 自身（＝今と同じ位置）になる。
    const { getByTestId, onAssign } = await renderDropBoard();
    const card = getByTestId("tier-card-3");
    await fireEvent.press(card);
    setupDropGeometry();
    dropAt(110, 50); // カード2 の後半
    await fireEvent(card, "longPress");

    expect(onAssign).not.toHaveBeenCalled();
  });

  it("カードの後半に落とすと、次のカードの直前に挿入される", async () => {
    const { getByTestId, onAssign } = await renderDropBoard();
    const card = getByTestId("tier-card-1");
    await fireEvent.press(card);
    setupDropGeometry();
    // カード2 の後半 → 次はカード3
    dropAt(110, 50);
    await fireEvent(card, "longPress");

    expect(onAssign).toHaveBeenCalledWith(1, "0", 3);
  });

  it("末尾カードの後半に落とすと行の末尾に追加される", async () => {
    const { getByTestId, onAssign } = await renderDropBoard();
    const card = getByTestId("tier-card-1");
    await fireEvent.press(card);
    setupDropGeometry();
    // カード3（x 128-188）の後半
    dropAt(170, 50);
    await fireEvent(card, "longPress");

    expect(onAssign).toHaveBeenCalledWith(1, "0", undefined);
  });

  it("自分の元の位置に落としても配置は変わらない", async () => {
    // ドラッグ中のカードはヒットテストから外れるため、元の枡目に落とした
    // 場合は「行内・カード非ヒット」扱いになり、同じ行なら位置を維持する。
    const { getByTestId, onAssign } = await renderDropBoard();
    const card = getByTestId("tier-card-1");
    await fireEvent.press(card);
    setupDropGeometry();
    dropAt(30, 50); // カード1 の矩形内
    await fireEvent(card, "longPress");

    expect(onAssign).not.toHaveBeenCalled();
  });

  it("行内の余白（カード無し）に落としても、同じ行なら配置は変わらない", async () => {
    const { getByTestId, onAssign } = await renderDropBoard();
    const card = getByTestId("tier-card-1");
    await fireEvent.press(card);
    setupDropGeometry();
    dropAt(250, 50); // 行 "0" 内だがどのカードにも当たらない
    await fireEvent(card, "longPress");

    expect(onAssign).not.toHaveBeenCalled();
  });

  it("別の行のカードの上に落とすと、その位置に挿入される", async () => {
    const assignment: TierAssignment = new Map([
      [1, "0"],
      [2, "0"],
      [3, "0"],
      [4, "1"],
    ]);
    const onAssign = jest.fn();
    const { getByTestId } = await render(
      boardElement({ items: BOARD_ITEMS, assignment, onAssign }),
    );
    const card = getByTestId("tier-card-1");
    await fireEvent.press(card);
    setupDropGeometry();
    mockCardRegistry!.registerCard(4, {
      x: 0,
      y: 134,
      width: 60,
      height: 116,
    });

    // 行 "1" のカード4 の前半に落とす
    dropAt(20, 180);
    await fireEvent(card, "longPress");

    expect(onAssign).toHaveBeenCalledWith(1, "1", 4);
  });

  it("別の行のカード以外の場所に落とすと従来通り末尾に追加される", async () => {
    const { getByTestId, onAssign } = await renderDropBoard();
    const card = getByTestId("tier-card-1");
    await fireEvent.press(card);
    setupDropGeometry();
    dropAt(250, 180); // 行 "1"（空）の中
    await fireEvent(card, "longPress");

    expect(onAssign).toHaveBeenCalledWith(1, "1");
  });

  it("トレイのカードを行内のカードの前に落とすと、その位置に挿入される", async () => {
    const { getByTestId, onAssign } = await renderDropBoard();
    const card = getByTestId("tier-card-4");
    await fireEvent.press(card);
    setupDropGeometry();
    // 行 "0" のカード2 の前半に落とす
    dropAt(80, 50);
    await fireEvent(card, "longPress");

    expect(onAssign).toHaveBeenCalledWith(4, "0", 2);
  });
});

describe("ドラッグ中カードの重なり順", () => {
  it("tier 内のカードをドラッグ中は、その行と盤面が最前面になる", async () => {
    const { getByTestId } = await render(
      boardElement({ items: ITEMS, assignment: ASSIGNMENT }),
    );

    await fireEvent.press(getByTestId("tier-card-1"));

    // 下段の行より手前に出すため、ドラッグ中カードを含む行自体を持ち上げる。
    // カード自身の zIndex だけでは、後に描画される別の行（特に Web は全 View が
    // stacking context を持つ）や未分類トレイの下に潜ってしまうため。
    expect(zIndexOf(getByTestId("tier-row-0"))).toBeGreaterThan(0);
    // ドラッグしていない行は持ち上げない
    expect(zIndexOf(getByTestId("tier-row-1")) ?? 0).toBe(0);
    // 盤面より後に描画される未分類トレイの下に潜らないよう、盤面も持ち上げる
    expect(zIndexOf(getByTestId("tier-board"))).toBeGreaterThan(0);
  });

  it("未分類トレイのカードをドラッグ中は、トレイが最前面になる", async () => {
    const { getByTestId } = await render(
      boardElement({ items: ITEMS, assignment: ASSIGNMENT }),
    );

    await fireEvent.press(getByTestId("tier-card-3"));

    expect(zIndexOf(getByTestId("tier-tray"))).toBeGreaterThan(0);
  });

  it("ドラッグがキャンセルされても元の重なり順に戻る", async () => {
    const { getByTestId } = await render(
      boardElement({ items: ITEMS, assignment: ASSIGNMENT }),
    );

    const card = getByTestId("tier-card-1");
    await fireEvent.press(card);
    // onEnd を通らないキャンセル（別ジェスチャに奪われた等）を再現する
    await fireEvent(card, "touchCancel");

    expect(zIndexOf(getByTestId("tier-row-0")) ?? 0).toBe(0);
    expect(zIndexOf(getByTestId("tier-board")) ?? 0).toBe(0);
  });

  it("ドラッグ終了後は元の重なり順に戻る", async () => {
    const { getByTestId } = await render(
      boardElement({ items: ITEMS, assignment: ASSIGNMENT }),
    );

    const card = getByTestId("tier-card-1");
    await fireEvent.press(card);
    await fireEvent(card, "longPress");

    expect(zIndexOf(getByTestId("tier-row-0")) ?? 0).toBe(0);
    expect(zIndexOf(getByTestId("tier-board")) ?? 0).toBe(0);
  });
});
