import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useMeishiDocument } from "@/lib/meishi/useMeishiDocument";
import { loadMeishiLibrary, saveMeishiLibrary } from "@/lib/meishi/storage";
import type {
  MeishiCardData,
  MeishiDocument,
  MeishiLibrary,
} from "@/lib/meishi/types";

jest.mock("@/lib/meishi/storage", () => ({
  clearMeishiDocument: jest.fn(),
  loadMeishiDocument: jest.fn(),
  loadMeishiLibrary: jest.fn(),
  saveMeishiLibrary: jest.fn(),
}));

const mockLoadLibrary = jest.mocked(loadMeishiLibrary);
const mockSaveLibrary = jest.mocked(saveMeishiLibrary);

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

beforeEach(async () => {
  jest.useRealTimers();
  jest.clearAllMocks();
  mockLoadLibrary.mockResolvedValue(null);
  mockSaveLibrary.mockResolvedValue(undefined);
});

afterEach(async () => {
  jest.useRealTimers();
});

describe("useMeishiDocument のバインド", () => {
  it("cardId を渡すとそのカードのドキュメントを編集対象にする", async () => {
    mockLoadLibrary.mockResolvedValue(
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
    mockLoadLibrary.mockResolvedValue(lib);
    const { result } = await renderHook(() => useMeishiDocument());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.boundCardId).toBe("b");
  });

  it("fresh モードでは既定カードがあっても doc は null（新規作成フロー）", async () => {
    mockLoadLibrary.mockResolvedValue(
      libraryFixture([cardFixture({ id: "a" })]),
    );
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

    expect(mockSaveLibrary).not.toHaveBeenCalled();
  });

  it("バインド済みカードでは saveDocument がそのカードのドキュメントを更新する", async () => {
    mockLoadLibrary.mockResolvedValue(
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

    expect(mockSaveLibrary).toHaveBeenCalledTimes(1);
    const saved = mockSaveLibrary.mock.calls[0][0];
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

    const saved = mockSaveLibrary.mock.calls[0][0];
    expect(saved.cards).toHaveLength(1);
    const createdId = saved.cards[0].id;
    // ライブラリは空でも作られたカードが唯一なので既定になる
    expect(saved.defaultCardId).toBe(createdId);
    expect(result.current.boundCardId).toBe(createdId);

    // 2 回目の保存は新規作成ではなく同じカードの更新になる
    mockLoadLibrary.mockResolvedValue(saved);
    await act(() => {
      result.current.setDocFromTemplate(updatedDoc);
    });
    await act(async () => {
      await result.current.saveDocument();
    });
    const saved2 = mockSaveLibrary.mock.calls[1][0];
    expect(saved2.cards).toHaveLength(1);
    expect(saved2.cards[0].document).toEqual(updatedDoc);
  });

  it("reloadDocument でバインド中カードの最新ドキュメントを読み直す", async () => {
    mockLoadLibrary.mockResolvedValue(
      libraryFixture([cardFixture({ id: "a" })]),
    );
    const { result } = await renderHook(() =>
      useMeishiDocument({ cardId: "a" }),
    );
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.doc).toEqual(sampleDoc);

    mockLoadLibrary.mockResolvedValue(
      libraryFixture([cardFixture({ id: "a", document: updatedDoc })]),
    );
    await act(async () => {
      await result.current.reloadDocument();
    });
    expect(result.current.doc).toEqual(updatedDoc);
  });
});
