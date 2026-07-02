import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearMeishiDocument,
  loadMeishiDocument,
  saveMeishiDocument,
} from "./storage";
import {
  emptyHistory,
  commit as commitHistory,
  redo as redoHistory,
  undo as undoHistory,
} from "./history";
import type { History } from "./history";
import type { MeishiDocument, MeishiElement } from "./types";

export type UseMeishiDocument = ReturnType<typeof useMeishiDocument>;

/**
 * 名刺ドキュメントの状態管理。
 *
 * - update系 API はデフォルトで履歴を積んでコミットする。
 * - 永続化は saveDocument() を呼んだ時だけ行う。
 * - `pushHistoryBeforeNextChange()` を呼んでから setDocLive で複数回更新すれば、
 *   ジェスチャ中の高頻度更新でも1コミットにまとめられる。
 */
export function useMeishiDocument() {
  const [doc, setDoc] = useState<MeishiDocument | null>(null);
  const [loaded, setLoaded] = useState(false);
  const historyRef = useRef<History>(emptyHistory());
  const [historyVersion, setHistoryVersion] = useState(0);

  // ジェスチャ開始時に呼ばれ、次の変更前に「その時点」を履歴に積むためのフラグ
  const pendingHistorySnapshotRef = useRef<MeishiDocument | null>(null);

  const bumpHistoryVersion = useCallback(
    () => setHistoryVersion((v) => v + 1),
    [],
  );

  const reloadDocument = useCallback(async () => {
    const persisted = await loadMeishiDocument();
    setDoc(persisted);
    setLoaded(true);
    historyRef.current = emptyHistory();
    pendingHistorySnapshotRef.current = null;
    bumpHistoryVersion();
  }, [bumpHistoryVersion]);

  useEffect(() => {
    let cancelled = false;
    loadMeishiDocument().then((persisted) => {
      if (cancelled) return;
      setDoc(persisted);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 履歴を積むコミット
  const commit = useCallback(
    (updater: (prev: MeishiDocument) => MeishiDocument) => {
      setDoc((prev) => {
        if (!prev) return prev;
        historyRef.current = commitHistory(historyRef.current, prev);
        bumpHistoryVersion();
        return updater(prev);
      });
    },
    [bumpHistoryVersion],
  );

  // 履歴を積まないライブ更新（ジェスチャ中用）
  const setDocLive = useCallback(
    (updater: (prev: MeishiDocument) => MeishiDocument) => {
      setDoc((prev) => {
        if (!prev) return prev;
        // 事前スナップショットがあればコミットする（onStart で1度だけ）
        if (pendingHistorySnapshotRef.current) {
          historyRef.current = commitHistory(
            historyRef.current,
            pendingHistorySnapshotRef.current,
          );
          pendingHistorySnapshotRef.current = null;
          bumpHistoryVersion();
        }
        return updater(prev);
      });
    },
    [bumpHistoryVersion],
  );

  const beginGesture = useCallback(() => {
    // その時点の doc をスナップショット。次の setDocLive で履歴に積む。
    setDoc((prev) => {
      pendingHistorySnapshotRef.current = prev;
      return prev;
    });
  }, []);

  const replaceWithoutHistory = useCallback(
    (next: MeishiDocument) => {
      historyRef.current = emptyHistory();
      bumpHistoryVersion();
      setDoc(next);
    },
    [bumpHistoryVersion],
  );

  const undo = useCallback(() => {
    setDoc((prev) => {
      if (!prev) return prev;
      const result = undoHistory(historyRef.current, prev);
      if (!result) return prev;
      historyRef.current = result.history;
      bumpHistoryVersion();
      return result.doc;
    });
  }, [bumpHistoryVersion]);

  const redo = useCallback(() => {
    setDoc((prev) => {
      if (!prev) return prev;
      const result = redoHistory(historyRef.current, prev);
      if (!result) return prev;
      historyRef.current = result.history;
      bumpHistoryVersion();
      return result.doc;
    });
  }, [bumpHistoryVersion]);

  const clear = useCallback(async () => {
    await clearMeishiDocument();
    setDoc(null);
    historyRef.current = emptyHistory();
    bumpHistoryVersion();
  }, [bumpHistoryVersion]);

  const saveDocument = useCallback(async () => {
    if (!doc) return;
    await saveMeishiDocument(doc);
  }, [doc]);

  const updateElement = useCallback(
    (id: string, patch: Partial<MeishiElement>) => {
      commit((prev) => ({
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === id ? ({ ...el, ...patch } as MeishiElement) : el,
        ),
      }));
    },
    [commit],
  );

  const setElementTransformLive = useCallback(
    (id: string, transform: MeishiElement["transform"]) => {
      setDocLive((prev) => ({
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === id ? ({ ...el, transform } as MeishiElement) : el,
        ),
      }));
    },
    [setDocLive],
  );

  const addElement = useCallback(
    (element: MeishiElement) => {
      commit((prev) => ({ ...prev, elements: [...prev.elements, element] }));
    },
    [commit],
  );

  const removeElement = useCallback(
    (id: string) => {
      commit((prev) => ({
        ...prev,
        elements: prev.elements.filter((el) => el.id !== id),
      }));
    },
    [commit],
  );

  const duplicateElement = useCallback(
    (id: string, newId: string) => {
      commit((prev) => {
        const source = prev.elements.find((el) => el.id === id);
        if (!source) return prev;
        const copy: MeishiElement = {
          ...source,
          id: newId,
          transform: {
            ...source.transform,
            x: Math.min(0.95, source.transform.x + 0.03),
            y: Math.min(0.95, source.transform.y + 0.03),
          },
        };
        return { ...prev, elements: [...prev.elements, copy] };
      });
    },
    [commit],
  );

  const bringToFront = useCallback(
    (id: string) => {
      commit((prev) => {
        const idx = prev.elements.findIndex((el) => el.id === id);
        if (idx < 0) return prev;
        const el = prev.elements[idx];
        const next = prev.elements.filter((e) => e.id !== id);
        next.push(el);
        return { ...prev, elements: next };
      });
    },
    [commit],
  );

  const sendToBack = useCallback(
    (id: string) => {
      commit((prev) => {
        const idx = prev.elements.findIndex((el) => el.id === id);
        if (idx < 0) return prev;
        const el = prev.elements[idx];
        const next = prev.elements.filter((e) => e.id !== id);
        next.unshift(el);
        return { ...prev, elements: next };
      });
    },
    [commit],
  );

  const setBackground = useCallback(
    (background: MeishiDocument["canvas"]["background"]) => {
      commit((prev) => ({
        ...prev,
        canvas: { ...prev.canvas, background },
      }));
    },
    [commit],
  );

  return {
    doc,
    loaded,
    setDocFromTemplate: (next: MeishiDocument) => replaceWithoutHistory(next),
    reloadDocument,
    saveDocument,
    commit,
    beginGesture,
    setElementTransformLive,
    updateElement,
    addElement,
    removeElement,
    duplicateElement,
    bringToFront,
    sendToBack,
    setBackground,
    undo,
    redo,
    clear,
    canUndo: historyVersion >= 0 && historyRef.current.past.length > 0,
    canRedo: historyVersion >= 0 && historyRef.current.future.length > 0,
  };
}
