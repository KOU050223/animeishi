import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useMeishiLibrary } from "@/lib/meishi/useMeishiLibrary";
import { loadMeishiLibrary, saveMeishiLibrary } from "@/lib/meishi/storage";
import type { MeishiDocument, MeishiLibrary } from "@/lib/meishi/types";

jest.mock("@/lib/meishi/storage", () => ({
  clearMeishiDocument: jest.fn(),
  loadMeishiDocument: jest.fn(),
  loadMeishiLibrary: jest.fn(),
  saveMeishiLibrary: jest.fn(),
}));

const mockLoad = jest.mocked(loadMeishiLibrary);
const mockSave = jest.mocked(saveMeishiLibrary);

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

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue(null);
  mockSave.mockResolvedValue(undefined);
});

describe("useMeishiLibrary", () => {
  it("保存済みライブラリを読み込む", async () => {
    mockLoad.mockResolvedValue(libraryWithTwoCards());
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
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0].cards).toHaveLength(1);
  });

  it("duplicateCard でカードを複製する", async () => {
    mockLoad.mockResolvedValue(libraryWithTwoCards());
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
    mockLoad.mockResolvedValue(libraryWithTwoCards());
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.removeCard("a");
    });

    expect(result.current.cards.map((c) => c.id)).toEqual(["b"]);
    expect(result.current.defaultCard?.id).toBe("b");
  });

  it("setDefault で既定を切り替える", async () => {
    mockLoad.mockResolvedValue(libraryWithTwoCards());
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));

    await act(async () => {
      await result.current.setDefault("b");
    });

    expect(result.current.defaultCard?.id).toBe("b");
    expect(mockSave.mock.calls.at(-1)?.[0].defaultCardId).toBe("b");
  });

  it("updateCardDocument で指定カードのドキュメントを更新する", async () => {
    mockLoad.mockResolvedValue(libraryWithTwoCards());
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

  it("reload で保存先から読み直す", async () => {
    const { result } = await renderHook(() => useMeishiLibrary());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.cards).toHaveLength(0);

    mockLoad.mockResolvedValue(libraryWithTwoCards());
    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.cards).toHaveLength(2);
  });
});
