import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useMeishiDocument } from "@/lib/meishi/useMeishiDocument";
import { loadMeishiLibrary } from "@/lib/meishi/storage";
import type {
  MeishiCardData,
  MeishiDocument,
  MeishiLibrary,
} from "@/lib/meishi/types";

// 実ストレージ（AsyncStorage は jest 環境でメモリ実装）を通して振る舞いを
// 見る。saveDocument の直列化はモックを挟むと検証できないため。

const LIBRARY_KEY = "meishi-library:v1";

const sampleDoc: MeishiDocument = {
  version: 1,
  canvas: {
    aspectRatio: 1.6,
    background: { kind: "solid", color: "#ffffff" },
  },
  elements: [],
};

const updatedDoc: MeishiDocument = {
  ...sampleDoc,
  canvas: {
    ...sampleDoc.canvas,
    background: { kind: "solid", color: "#111827" },
  },
};

function cardFixture(partial: Partial<MeishiCardData> = {}): MeishiCardData {
  return {
    id: "card-a",
    name: "名刺 1",
    document: sampleDoc,
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  };
}

function libraryFixture(cards: MeishiCardData[]): MeishiLibrary {
  return { version: 1, cards, defaultCardId: cards[0]?.id ?? null };
}

async function seedLibrary(library: MeishiLibrary) {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
}

beforeEach(async () => {
  jest.useRealTimers();
  await AsyncStorage.clear();
});

afterEach(async () => {
  jest.useRealTimers();
});

describe("useMeishiDocument のバインド", () => {
  it("cardId を渡すとそのカードのドキュメントを編集対象にする", async () => {
    await seedLibrary(
      libraryFixture([cardFixture({ id: "x" }), cardFixture({ id: "y" })]),
    );
    const { result } = await renderHook(() =>
      useMeishiDocument({ cardId: "y" }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.doc).toEqual(sampleDoc);
    expect(result.current.boundCardId).toBe("y");
  });

  it("引数なしは既定カードを編集対象にする", async () => {
    const lib = libraryFixture([
      cardFixture({ id: "a" }),
      cardFixture({ id: "b" }),
    ]);
    lib.defaultCardId = "b";
    await seedLibrary(lib);
    const { result } = await renderHook(() => useMeishiDocument());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.boundCardId).toBe("b");
  });

  it("fresh モードでは既定カードがあっても doc は null（新規作成フロー）", async () => {
    await seedLibrary(libraryFixture([cardFixture({ id: "a" })]));
    const { result } = await renderHook(() =>
      useMeishiDocument({ fresh: true }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.doc).toBeNull();
    expect(result.current.boundCardId).toBeNull();
  });

  it("ライブラリが空なら doc は null でバインドも無い", async () => {
    const { result } = await renderHook(() => useMeishiDocument());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.doc).toBeNull();
    expect(result.current.boundCardId).toBeNull();
  });
});

describe("useMeishiDocument の永続化", () => {
  it("ドキュメント変更だけでは自動保存しない", async () => {
    const { result } = await renderHook(() => useMeishiDocument());

    await waitFor(() => expect(result.current.loaded).toBe(true));

    jest.useFakeTimers();
    await act(() => {
      result.current.setDocFromTemplate(sampleDoc);
    });
    await act(() => {
      jest.advanceTimersByTime(1000);
    });

    expect(await AsyncStorage.getItem(LIBRARY_KEY)).toBeNull();
  });

  it("バインド済みカードでは saveDocument がそのカードのドキュメントを更新する", async () => {
    await seedLibrary(
      libraryFixture([cardFixture({ id: "a" }), cardFixture({ id: "b" })]),
    );
    const { result } = await renderHook(() =>
      useMeishiDocument({ cardId: "b" }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(() => {
      result.current.setDocFromTemplate(updatedDoc);
    });
    await act(async () => {
      await result.current.saveDocument();
    });

    const saved = (await loadMeishiLibrary())!;
    expect(saved.cards.find((c) => c.id === "b")?.document).toEqual(updatedDoc);
    expect(saved.cards.find((c) => c.id === "a")?.document).toEqual(sampleDoc);
  });

  it("未バインドの saveDocument は新規カードを作り、以後そのカードにバインドする", async () => {
    const { result } = await renderHook(() =>
      useMeishiDocument({ fresh: true }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(() => {
      result.current.setDocFromTemplate(sampleDoc);
    });
    await act(async () => {
      await result.current.saveDocument();
    });

    const saved = (await loadMeishiLibrary())!;
    expect(saved.cards).toHaveLength(1);
    const createdId = saved.cards[0].id;
    // ライブラリは空でも作られたカードが唯一なので既定になる
    expect(saved.defaultCardId).toBe(createdId);
    expect(result.current.boundCardId).toBe(createdId);

    // 2 回目の保存は新規作成ではなく同じカードの更新になる
    await act(() => {
      result.current.setDocFromTemplate(updatedDoc);
    });
    await act(async () => {
      await result.current.saveDocument();
    });
    const saved2 = (await loadMeishiLibrary())!;
    expect(saved2.cards).toHaveLength(1);
    expect(saved2.cards[0].id).toBe(createdId);
    expect(saved2.cards[0].document).toEqual(updatedDoc);
  });

  it("reloadDocument でバインド中カードの最新ドキュメントを読み直す", async () => {
    await seedLibrary(libraryFixture([cardFixture({ id: "a" })]));
    const { result } = await renderHook(() =>
      useMeishiDocument({ cardId: "a" }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.doc).toEqual(sampleDoc);

    await seedLibrary(
      libraryFixture([cardFixture({ id: "a", document: updatedDoc })]),
    );
    await act(async () => {
      await result.current.reloadDocument();
    });
    expect(result.current.doc).toEqual(updatedDoc);
  });
});
