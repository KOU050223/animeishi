import {
  assignWork,
  parseTiersJson,
  pruneAssignment,
  toAssignment,
  toSaveItems,
  unassignedWorks,
  worksInTier,
} from "./board";
import type { TierRow, TierWork } from "./types";

const TIERS: TierRow[] = [
  { key: "s", label: "神", color: "#ff7f7f" },
  { key: "a", label: "強", color: "#ffbf7f" },
];

const WORKS: TierWork[] = [
  { annictWorkId: 1, title: "アニメ1" },
  { annictWorkId: 2, title: "アニメ2" },
  { annictWorkId: 3, title: "アニメ3" },
];

describe("assignWork", () => {
  it("未配置の作品を tier に配置する", () => {
    const next = assignWork(new Map(), 1, "s");
    expect(next.get(1)).toBe("s");
  });

  it("既に別 tier にいる作品は移動になる（重複しない）", () => {
    const next = assignWork(new Map([[1, "s"]]), 1, "a");
    expect(next.get(1)).toBe("a");
    expect(next.size).toBe(1);
  });

  it("tierKey に null を渡すと未分類へ戻す", () => {
    const next = assignWork(new Map([[1, "s"]]), 1, null);
    expect(next.has(1)).toBe(false);
  });

  it("配置済みの作品を入れ直すと末尾に移る", () => {
    const next = assignWork(
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
    assignWork(original, 2, "a");
    expect(original.size).toBe(1);
  });
});

describe("worksInTier", () => {
  it("指定 tier の作品を配置順で返す", () => {
    const assignment = new Map([
      [3, "s"],
      [1, "s"],
      [2, "a"],
    ]);
    expect(
      worksInTier(WORKS, assignment, "s").map((w) => w.annictWorkId),
    ).toEqual([3, 1]);
  });

  it("作品一覧に無い ID は無視する（シーズン切替で消えた作品）", () => {
    const assignment = new Map([[999, "s"]]);
    expect(worksInTier(WORKS, assignment, "s")).toEqual([]);
  });
});

describe("unassignedWorks", () => {
  it("どの tier にも配置されていない作品を返す", () => {
    const assignment = new Map([[2, "s"]]);
    expect(
      unassignedWorks(WORKS, assignment).map((w) => w.annictWorkId),
    ).toEqual([1, 3]);
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
      { annictWorkId: 1, tierKey: "s" },
      { annictWorkId: 2, tierKey: "a" },
      { annictWorkId: 3, tierKey: "a" },
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
      { annictWorkId: 1, tierKey: "s" },
      { annictWorkId: 2, tierKey: "a" },
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
    // 不正な行だけを捨てると、その行の作品が表示も保存もされず消えるため、
    // 一部でも壊れていれば全体を既定値にフォールバックさせる。
    expect(
      parseTiersJson(JSON.stringify([TIERS[0], { key: "bad" }])),
    ).toBeNull();
  });
});
