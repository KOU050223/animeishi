import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useMeishiDocument } from "@/lib/meishi/useMeishiDocument";
import * as historyModule from "@/lib/meishi/history";
import { loadMeishiLibrary } from "@/lib/meishi/storage";
import { captureAnalyticsEvent } from "@/lib/analytics/client";
import { resetEventTrackingForTest } from "@/lib/events";
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
  jest.mocked(captureAnalyticsEvent).mockClear();
  resetEventTrackingForTest();
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
    const createdId = saved.cards[0]?.id;
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
    expect(saved2.cards[0]?.id).toBe(createdId);
    expect(saved2.cards[0]?.document).toEqual(updatedDoc);
  });

  it("名刺が 0 枚から 1 枚目を保存したときだけ meishi_create を送る", async () => {
    const { result } = await renderHook(() => useMeishiDocument());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(async () => result.current.setDocFromTemplate(sampleDoc));
    await act(async () => {
      await result.current.saveDocument();
    });
    await waitFor(() =>
      expect(captureAnalyticsEvent).toHaveBeenCalledWith(
        "meishi_create",
        expect.any(Object),
      ),
    );

    // 2 枚目（fresh）の保存では送らない
    jest.mocked(captureAnalyticsEvent).mockClear();
    const second = await renderHook(() => useMeishiDocument({ fresh: true }));
    await waitFor(() => expect(second.result.current.loaded).toBe(true));
    await act(async () => second.result.current.setDocFromTemplate(updatedDoc));
    await act(async () => {
      await second.result.current.saveDocument();
    });
    expect((await loadMeishiLibrary())?.cards).toHaveLength(2);
    expect(captureAnalyticsEvent).not.toHaveBeenCalledWith(
      "meishi_create",
      expect.anything(),
    );
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

describe("useMeishiDocument の undo / redo", () => {
  const docWithElement: MeishiDocument = {
    ...sampleDoc,
    elements: [
      {
        id: "el_1",
        type: "text",
        transform: { x: 0.1, y: 0.1, width: 0.3, height: 0.1, rotation: 0 },
        text: "テスト",
        source: "custom",
        fontSize: 16,
        fontFamily: "system",
        fontWeight: "normal",
        fontStyle: "normal",
        color: "#000000",
        align: "left",
      },
    ],
  };

  async function renderWithDoc(doc: MeishiDocument) {
    const { result } = await renderHook(() => useMeishiDocument());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await act(() => {
      result.current.setDocFromTemplate(doc);
    });
    return result;
  }

  it("変更を積むと undo で直前のドキュメントに戻り、redo でやり直せる", async () => {
    const result = await renderWithDoc(sampleDoc);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);

    await act(() => {
      result.current.setBackground({ kind: "solid", color: "#111827" });
    });
    expect(result.current.canUndo).toBe(true);

    await act(() => {
      result.current.undo();
    });
    expect(result.current.doc).toEqual(sampleDoc);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    await act(() => {
      result.current.redo();
    });
    expect(result.current.doc).toEqual(updatedDoc);
    expect(result.current.canRedo).toBe(false);
  });

  it("ジェスチャ中の連続ライブ更新は履歴 1 件にまとまる", async () => {
    const result = await renderWithDoc(docWithElement);
    const transform = {
      x: 0.5,
      y: 0.5,
      width: 0.3,
      height: 0.1,
      rotation: 0,
    };

    await act(() => {
      result.current.beginGesture();
      result.current.setElementTransformLive("el_1", {
        ...transform,
        x: 0.4,
      });
      result.current.setElementTransformLive("el_1", transform);
    });

    expect(result.current.doc?.elements[0]?.transform).toEqual(transform);
    expect(result.current.canUndo).toBe(true);

    await act(() => {
      result.current.undo();
    });
    expect(result.current.doc).toEqual(docWithElement);
    expect(result.current.canUndo).toBe(false);
  });

  // Strict Mode は更新関数を 2 回呼ぶ。更新関数の中で履歴を積んでいると
  // 1 操作で 2 件積まれてしまう（issue #810）。undo 側の更新関数も二重に
  // 呼ばれるため「undo 1 回で canUndo が false になるか」では観測できない
  // （2 積み 2 ポップで帳消しになる）ので、history の commit / undo / redo
  // の呼び出し回数で 1 操作あたり履歴 1 件ずつ進むことを固定する。
  it("Strict Mode で更新関数が 2 回呼ばれても履歴は 1 件ずつ進む", async () => {
    const commitSpy = jest.spyOn(historyModule, "commit");
    const undoSpy = jest.spyOn(historyModule, "undo");
    const redoSpy = jest.spyOn(historyModule, "redo");
    try {
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <React.StrictMode>{children}</React.StrictMode>
      );
      const { result } = await renderHook(() => useMeishiDocument(), {
        wrapper,
      });
      await waitFor(() => expect(result.current.loaded).toBe(true));
      await act(() => {
        result.current.setDocFromTemplate(sampleDoc);
      });
      commitSpy.mockClear();

      const secondEdit: MeishiDocument = {
        ...sampleDoc,
        canvas: {
          ...sampleDoc.canvas,
          background: { kind: "solid", color: "#222222" },
        },
      };

      await act(() => {
        result.current.setBackground({ kind: "solid", color: "#111827" });
        result.current.setBackground({ kind: "solid", color: "#222222" });
      });
      expect(commitSpy).toHaveBeenCalledTimes(2);
      expect(result.current.doc).toEqual(secondEdit);

      await act(() => {
        result.current.undo();
      });
      expect(undoSpy).toHaveBeenCalledTimes(1);
      expect(result.current.doc).toEqual(updatedDoc);

      await act(() => {
        result.current.redo();
      });
      expect(redoSpy).toHaveBeenCalledTimes(1);
      expect(result.current.doc).toEqual(secondEdit);
      expect(result.current.canRedo).toBe(false);
    } finally {
      commitSpy.mockRestore();
      undoSpy.mockRestore();
      redoSpy.mockRestore();
    }
  });
});
