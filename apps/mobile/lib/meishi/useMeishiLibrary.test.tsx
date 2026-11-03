import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useMeishiLibrary } from "@/lib/meishi/useMeishiLibrary";
import { loadMeishiLibrary } from "@/lib/meishi/storage";
import type { MeishiDocument, MeishiLibrary } from "@/lib/meishi/types";

// 実ストレージ（AsyncStorage は jest 環境でメモリ実装）を通して振る舞いを
// 見る。操作の直列化はモックを挟むと検証できないため。

const LIBRARY_KEY = "meishi-library:v1";

const sampleDoc: MeishiDocument = {
  version: 1,
  canvas: {
    aspectRatio: 1.6,
    background: { kind: "solid", color: "#ffffff" },
  },
  elements: [],
};

function libraryWithTwoCards(): MeishiLibrary {
  return {
    version: 1,
    cards: [
      {
        id: "a",
        name: "名刺 1",
        document: sampleDoc,
        createdAt: 1,
        updatedAt: 1,
      },
      {
        id: "b",
        name: "名刺 2",
        document: sampleDoc,
        createdAt: 2,
        updatedAt: 2,
      },
    ],
    defaultCardId: "a",
  };
}

async function seedLibrary(library: MeishiLibrary) {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("useMeishiLibrary", () => {
  it("保存済みライブラリを読み込む", async () => {
    await seedLibrary(libraryWithTwoCards());
    const { result } = await renderHook(() => useMeishiLibrary());

    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.cards).toHaveLength(2);
    expect(result.current.defaultCard?.id).toBe("a");
  });

  it("addCard でカードを追加して保存する。最初の 1 枚は既定になる", async () => {
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    let createdId = "";
    await act(async () => {
      createdId = (await result.current.addCard(sampleDoc)).id;
    });

    expect(result.current.cards).toHaveLength(1);
    expect(result.current.defaultCard?.id).toBe(createdId);
    const stored = await loadMeishiLibrary();
    expect(stored!.cards).toHaveLength(1);
    expect(stored!.defaultCardId).toBe(createdId);
  });

  it("duplicateCard でカードを複製する", async () => {
    await seedLibrary(libraryWithTwoCards());
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.duplicateCard("a");
    });

    expect(result.current.cards).toHaveLength(3);
    expect(result.current.cards[1].name).toBe("名刺 1 のコピー");
    expect(result.current.defaultCard?.id).toBe("a");
  });

  it("removeCard でカードを削除し、既定が消えたら最古を繰り上げる", async () => {
    await seedLibrary(libraryWithTwoCards());
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.removeCard("a");
    });

    expect(result.current.cards.map((c) => c.id)).toEqual(["b"]);
    expect(result.current.defaultCard?.id).toBe("b");
  });

  it("setDefault で既定を切り替える", async () => {
    await seedLibrary(libraryWithTwoCards());
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.setDefault("b");
    });

    expect(result.current.defaultCard?.id).toBe("b");
    expect((await loadMeishiLibrary())!.defaultCardId).toBe("b");
  });

  it("updateCardDocument で指定カードのドキュメントを更新する", async () => {
    await seedLibrary(libraryWithTwoCards());
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    const nextDoc: MeishiDocument = {
      ...sampleDoc,
      canvas: {
        ...sampleDoc.canvas,
        background: { kind: "solid", color: "#000000" },
      },
    };
    await act(async () => {
      await result.current.updateCardDocument("b", nextDoc);
    });

    expect(result.current.cards[1].document).toEqual(nextDoc);
    expect(result.current.cards[0].document).toEqual(sampleDoc);
  });

  it("複製→削除を await せず連続実行しても、両方の結果が保存に残る", async () => {
    await seedLibrary(libraryWithTwoCards());
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    // レビュー指摘: 連続操作で先の保存が後の状態を上書きする不具合。
    // a の複製と a の削除を待たずに投げても、直列化により順に適用される。
    await act(async () => {
      const p1 = result.current.duplicateCard("a");
      const p2 = result.current.removeCard("a");
      await Promise.all([p1, p2]);
    });

    const ids = result.current.cards.map((c) => c.id);
    expect(ids).not.toContain("a");
    expect(result.current.cards.some((c) => c.name === "名刺 1 のコピー")).toBe(
      true,
    );
    // 画面 state と保存済みが一致している（保存の巻き戻りがない）
    const stored = await loadMeishiLibrary();
    expect(stored!.cards.map((c) => c.id)).toEqual(ids);
  });

  it("reload で保存先から読み直す", async () => {
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.cards).toHaveLength(0);

    await seedLibrary(libraryWithTwoCards());
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.cards).toHaveLength(2);
  });
});
