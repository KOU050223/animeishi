import { describe, expect, it } from "vitest";
import {
  addCard,
  defaultCard,
  duplicateCard,
  emptyLibrary,
  findCard,
  migrateLegacyDocument,
  nextCardName,
  removeCard,
  setDefaultCard,
  updateCardDocument,
} from "./library";
import type { MeishiCardData, MeishiDocument } from "./types";

const docA: MeishiDocument = {
  version: 1,
  canvas: {
    aspectRatio: 1.6,
    background: { kind: "solid", color: "#ffffff" },
  },
  elements: [],
};

const docB: MeishiDocument = {
  ...docA,
  canvas: { ...docA.canvas, background: { kind: "solid", color: "#111827" } },
};

function cardFixture(partial: Partial<MeishiCardData> = {}): MeishiCardData {
  return {
    id: "card-1",
    name: "名刺 1",
    document: docA,
    createdAt: 1000,
    updatedAt: 1000,
    ...partial,
  };
}

describe("emptyLibrary", () => {
  it("カードなし・既定なしの空ライブラリを返す", () => {
    expect(emptyLibrary()).toEqual({
      version: 1,
      cards: [],
      defaultCardId: null,
    });
  });
});

describe("addCard", () => {
  it("追加したカードに「名刺 N」の自動命名とタイムスタンプを付ける", () => {
    const { library, card } = addCard(emptyLibrary(), docA, { now: 42 });
    expect(card.name).toBe("名刺 1");
    expect(card.createdAt).toBe(42);
    expect(card.updatedAt).toBe(42);
    expect(library.cards).toHaveLength(1);
  });

  it("最初のカードは自動で既定になる", () => {
    const { library, card } = addCard(emptyLibrary(), docA);
    expect(library.defaultCardId).toBe(card.id);
  });

  it("2 枚目以降は既定を変えずに連番で命名する", () => {
    let lib = emptyLibrary();
    const first = addCard(lib, docA);
    lib = first.library;
    const second = addCard(lib, docB);
    lib = second.library;
    const third = addCard(lib, docA);

    expect(second.card.name).toBe("名刺 2");
    expect(third.card.name).toBe("名刺 3");
    expect(third.library.defaultCardId).toBe(first.card.id);
  });

  it("削除で空いた番号を再利用せず、既存の最大番号の次を採番する", () => {
    let lib = emptyLibrary();
    lib = addCard(lib, docA).library; // 名刺 1
    lib = addCard(lib, docA).library; // 名刺 2
    lib = addCard(lib, docA).library; // 名刺 3
    lib = removeCard(lib, lib.cards[1].id); // 名刺 2 を削除

    const { card } = addCard(lib, docB);
    expect(card.name).toBe("名刺 4");
  });
});

describe("duplicateCard", () => {
  it("ドキュメントを複製して「〜のコピー」で命名する", () => {
    const lib = addCard(emptyLibrary(), docA, {
      id: "src",
      now: 1000,
    }).library;
    const result = duplicateCard(lib, "src", { id: "copy", now: 2000 });

    expect(result).not.toBeNull();
    expect(result!.card.name).toBe("名刺 1 のコピー");
    expect(result!.card.document).toEqual(docA);
    expect(result!.card.id).toBe("copy");
    expect(result!.card.createdAt).toBe(2000);
    expect(result!.library.cards).toHaveLength(2);
  });

  it("複製は既定を変えない", () => {
    const lib = addCard(emptyLibrary(), docA, { id: "src" }).library;
    const result = duplicateCard(lib, "src");
    expect(result!.library.defaultCardId).toBe("src");
    expect(result!.card.id).not.toBe("src");
  });

  it("存在しないカードは複製できず null を返す", () => {
    expect(duplicateCard(emptyLibrary(), "missing")).toBeNull();
  });
});

describe("removeCard", () => {
  it("カードを取り除く", () => {
    let lib = addCard(emptyLibrary(), docA, { id: "a" }).library;
    lib = addCard(lib, docB, { id: "b" }).library;
    lib = removeCard(lib, "b");
    expect(lib.cards.map((c) => c.id)).toEqual(["a"]);
  });

  it("既定カードを消したら残っている最古のカードを既定に繰り上げる", () => {
    let lib = emptyLibrary();
    lib = addCard(lib, docA, { id: "a", now: 1 }).library;
    lib = addCard(lib, docA, { id: "b", now: 2 }).library;
    lib = addCard(lib, docA, { id: "c", now: 3 }).library;
    lib = setDefaultCard(lib, "c");

    lib = removeCard(lib, "c");
    expect(lib.defaultCardId).toBe("a");
  });

  it("既定カードを消して残りが無ければ既定なしになる", () => {
    const lib = addCard(emptyLibrary(), docA, { id: "a" }).library;
    const next = removeCard(lib, "a");
    expect(next.cards).toHaveLength(0);
    expect(next.defaultCardId).toBeNull();
  });

  it("既定でないカードを消しても既定は維持される", () => {
    let lib = emptyLibrary();
    lib = addCard(lib, docA, { id: "a" }).library;
    lib = addCard(lib, docA, { id: "b" }).library;
    lib = removeCard(lib, "b");
    expect(lib.defaultCardId).toBe("a");
  });
});

describe("setDefaultCard", () => {
  it("指定したカードを既定にする", () => {
    let lib = emptyLibrary();
    lib = addCard(lib, docA, { id: "a" }).library;
    lib = addCard(lib, docA, { id: "b" }).library;
    lib = setDefaultCard(lib, "b");
    expect(lib.defaultCardId).toBe("b");
  });

  it("存在しないカードは既定にできない（変化なし）", () => {
    const lib = addCard(emptyLibrary(), docA, { id: "a" }).library;
    expect(setDefaultCard(lib, "missing").defaultCardId).toBe("a");
  });
});

describe("updateCardDocument", () => {
  it("対象カードのドキュメントを差し替えて updatedAt を更新する", () => {
    const lib = addCard(emptyLibrary(), docA, { id: "a", now: 1 }).library;
    const next = updateCardDocument(lib, "a", docB, { now: 99 });
    const card = next.cards[0];
    expect(card.document).toEqual(docB);
    expect(card.updatedAt).toBe(99);
    expect(card.createdAt).toBe(1);
  });
});

describe("defaultCard / findCard", () => {
  it("既定カードを返す。無ければ null", () => {
    let lib = emptyLibrary();
    expect(defaultCard(lib)).toBeNull();
    lib = addCard(lib, docA, { id: "a" }).library;
    expect(defaultCard(lib)?.id).toBe("a");
  });

  it("id でカードを引ける。無ければ null", () => {
    const lib = addCard(emptyLibrary(), docA, { id: "a" }).library;
    expect(findCard(lib, "a")?.id).toBe("a");
    expect(findCard(lib, "nope")).toBeNull();
  });
});

describe("migrateLegacyDocument", () => {
  it("従来の単一ドキュメントを唯一の既定カードにする", () => {
    const lib = migrateLegacyDocument(docA, { id: "migrated", now: 7 });
    expect(lib.version).toBe(1);
    expect(lib.cards).toHaveLength(1);
    expect(lib.cards[0].id).toBe("migrated");
    expect(lib.cards[0].document).toEqual(docA);
    expect(lib.defaultCardId).toBe("migrated");
  });
});

describe("nextCardName", () => {
  it("「名刺 N」の最大番号の次を返す", () => {
    const cards = [
      cardFixture({ name: "名刺 1" }),
      cardFixture({ name: "名刺 3" }),
    ];
    expect(nextCardName(cards)).toBe("名刺 4");
  });

  it("自動命名のカードが無ければ 名刺 1", () => {
    expect(nextCardName([cardFixture({ name: "イベント用" })])).toBe("名刺 1");
  });
});
