import {
  assignItem,
  mergeBoardItems,
  parseTiersJson,
  pruneAssignment,
  sameBoard,
  toAssignment,
  toSaveItems,
  unassignedItems,
  itemsInTier,
} from "./board";
import type { TierRow, TierItem } from "./types";

const TIERS: TierRow[] = [
  { key: "s", label: "神", color: "#ff7f7f" },
  { key: "a", label: "強", color: "#ffbf7f" },
];

const ITEMS: TierItem[] = [
  { id: 1, title: "アニメ1" },
  { id: 2, title: "アニメ2" },
  { id: 3, title: "アニメ3" },
];

describe("assignItem", () => {
  it("未配置のアイテムを tier に配置する", () => {
    const next = assignItem(new Map(), 1, "s");
    expect(next.get(1)).toBe("s");
  });

  it("既に別 tier にいるアイテムは移動になる（重複しない）", () => {
    const next = assignItem(new Map([[1, "s"]]), 1, "a");
    expect(next.get(1)).toBe("a");
    expect(next.size).toBe(1);
  });

  it("tierKey に null を渡すと未分類へ戻す", () => {
    const next = assignItem(new Map([[1, "s"]]), 1, null);
    expect(next.has(1)).toBe(false);
  });

  it("配置済みのアイテムを入れ直すと末尾に移る", () => {
    const next = assignItem(
      new Map([
        [1, "s"],
        [2, "s"],
      ]),
      1,
      "s",
    );
    expect([...next.keys()]).toEqual([2, 1]);
  });

  it("元の Map を破壊しない", () => {
    const original = new Map([[1, "s"]]);
    assignItem(original, 2, "a");
    expect(original.size).toBe(1);
  });
});

describe("itemsInTier", () => {
  it("指定 tier のアイテムを配置順で返す", () => {
    const assignment = new Map([
      [3, "s"],
      [1, "s"],
      [2, "a"],
    ]);
    expect(itemsInTier(ITEMS, assignment, "s").map((w) => w.id)).toEqual([
      3, 1,
    ]);
  });

  it("アイテム一覧に無い ID は無視する（名簿から消えた対象）", () => {
    const assignment = new Map([[999, "s"]]);
    expect(itemsInTier(ITEMS, assignment, "s")).toEqual([]);
  });
});

describe("unassignedItems", () => {
  it("どの tier にも配置されていないアイテムを返す", () => {
    const assignment = new Map([[2, "s"]]);
    expect(unassignedItems(ITEMS, assignment).map((w) => w.id)).toEqual([1, 3]);
  });
});

describe("mergeBoardItems", () => {
  it("複数の供給元を前から順に連結する", () => {
    const savedOnly: TierItem[] = [{ id: 9, title: "シーズン外" }];
    const manual: TierItem[] = [{ id: 10, title: "手動追加" }];
    expect(
      mergeBoardItems(ITEMS, savedOnly, manual).map((item) => item.id),
    ).toEqual([1, 2, 3, 9, 10]);
  });

  it("同一 id は先に入った方を優先して重複を潰す", () => {
    const manual: TierItem[] = [
      { id: 2, title: "手動側のタイトル" },
      { id: 4, title: "新規" },
    ];
    const merged = mergeBoardItems(ITEMS, manual);
    expect(merged.map((item) => item.id)).toEqual([1, 2, 3, 4]);
    // シーズン候補側（先の供給元）のタイトルが残る
    expect(merged[1].title).toBe("アニメ2");
  });

  it("空・undefined の供給元を含めても動く", () => {
    expect(mergeBoardItems(ITEMS, undefined, [])).toEqual(ITEMS);
    expect(mergeBoardItems()).toEqual([]);
  });
});

describe("pruneAssignment", () => {
  it("tiers から消えた tier の配置を落とす", () => {
    const assignment = new Map([
      [1, "s"],
      [2, "zzz"],
    ]);
    const next = pruneAssignment(assignment, TIERS);
    expect(next.has(1)).toBe(true);
    expect(next.has(2)).toBe(false);
  });
});

describe("toSaveItems", () => {
  it("tier の並び順にまとめて items を組み立てる", () => {
    const assignment = new Map([
      [2, "a"],
      [1, "s"],
      [3, "a"],
    ]);
    expect(toSaveItems(assignment, TIERS)).toEqual([
      { itemId: 1, tierKey: "s" },
      { itemId: 2, tierKey: "a" },
      { itemId: 3, tierKey: "a" },
    ]);
  });

  it("tiers に無い tier の配置は送らない（サーバの検証で 400 になるため）", () => {
    const assignment = new Map([[1, "zzz"]]);
    expect(toSaveItems(assignment, TIERS)).toEqual([]);
  });
});

describe("toAssignment", () => {
  it("サーバの items を Map に戻す", () => {
    const assignment = toAssignment([
      { itemId: 1, tierKey: "s" },
      { itemId: 2, tierKey: "a" },
    ]);
    expect(assignment.get(1)).toBe("s");
    expect(assignment.get(2)).toBe("a");
  });

  it("toSaveItems と往復しても内容が変わらない", () => {
    const original = new Map([
      [1, "s"],
      [2, "a"],
    ]);
    expect(toAssignment(toSaveItems(original, TIERS))).toEqual(original);
  });
});

describe("parseTiersJson", () => {
  it("正しい JSON を TierRow[] に戻す", () => {
    expect(parseTiersJson(JSON.stringify(TIERS))).toEqual(TIERS);
  });

  it("壊れた JSON では null を返す（既定値へフォールバックさせる）", () => {
    expect(parseTiersJson("{{{")).toBeNull();
  });

  it("配列でない JSON では null を返す", () => {
    expect(parseTiersJson('{"key":"s"}')).toBeNull();
  });

  it("形の合わない要素だけの配列では null を返す", () => {
    expect(parseTiersJson('[{"key":"s"}]')).toBeNull();
  });

  it("有効な行と不正な行が混在していても null を返す", () => {
    // 不正な行だけを捨てると、その行のアイテムが表示も保存もされず消えるため、
    // 一部でも壊れていれば全体を既定値にフォールバックさせる。
    expect(
      parseTiersJson(JSON.stringify([TIERS[0], { key: "bad" }])),
    ).toBeNull();
  });
});

describe("sameBoard", () => {
  const snapshot = () => ({
    title: "テスト表",
    tiers: TIERS,
    items: [
      { itemId: 1, tierKey: "s" },
      { itemId: 2, tierKey: "a" },
    ],
  });

  it("title・tiers・配置がすべて同じなら true", () => {
    expect(sameBoard(snapshot(), snapshot())).toBe(true);
  });

  it("保存中にアイテムが動くと false（isDirty を解除しない判定に使う）", () => {
    const moved = snapshot();
    moved.items = [
      { itemId: 1, tierKey: "s" },
      { itemId: 3, tierKey: "a" },
    ];
    expect(sameBoard(snapshot(), moved)).toBe(false);
  });

  it("保存中に tier 名が変わると false", () => {
    const renamed = snapshot();
    renamed.tiers = [{ key: "s", label: "最高", color: "#ff7f7f" }, TIERS[1]];
    expect(sameBoard(snapshot(), renamed)).toBe(false);
  });

  it("配置順が違うだけでも false（position に影響するため）", () => {
    const reordered = snapshot();
    reordered.items = [reordered.items[1], reordered.items[0]];
    expect(sameBoard(snapshot(), reordered)).toBe(false);
  });
});
