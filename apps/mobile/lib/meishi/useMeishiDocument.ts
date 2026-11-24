import { useCallback, useEffect, useRef, useState } from "react";
import { addCard, defaultCard, findCard, updateCardDocument } from "./library";
import { loadMeishiLibrary, updateMeishiLibrary } from "./storage";
import {
  emptyHistory,
  commit as commitHistory,
  redo as redoHistory,
  undo as undoHistory,
} from "./history";
import type { History } from "./history";
import type { MeishiDocument, MeishiElement } from "./types";
import { trackEvent } from "@/lib/events";

export type UseMeishiDocument = ReturnType<typeof useMeishiDocument>;

export type UseMeishiDocumentOptions = {
  /**
   * 編集対象カードの id。一覧画面（/meishi）から特定カードを開くときに渡す。
   */
  cardId?: string;
  /**
   * 新規作成フロー。既定カードがあっても doc は null で始まり、
   * 最初の saveDocument で新しいカードが作られる（issue #427）。
   */
  fresh?: boolean;
};

/**
 * 名刺ドキュメントの状態管理。
 *
 * マルチ名刺（issue #427）では 1 枚の MeishiCardData にバインドする。
 * - cardId 指定 … そのカードを編集対象にする
 * - fresh … 未バインドの新規名刺（saveDocument でカード作成）
 * - 無指定 … 既定カード（無ければ新規名刺として振る舞う）
 *
 * - update系 API はデフォルトで履歴を積んでコミットする。
 * - 永続化は saveDocument() を呼んだ時だけ行う。
 * - `beginGesture()` を呼んでから setDocLive で複数回更新すれば、
 *   ジェスチャ中の高頻度更新でも1コミットにまとめられる。
 */
export function useMeishiDocument(options: UseMeishiDocumentOptions = {}) {
  const { cardId, fresh = false } = options;
  const [doc, setDoc] = useState<MeishiDocument | null>(null);
  const [loaded, setLoaded] = useState(false);
  // 編集対象カード。fresh / 未作成なら null（保存時に新規カードになる）。
  const [boundCardId, setBoundCardId] = useState<string | null>(null);
  const historyRef = useRef<History>(emptyHistory());
  // canUndo / canRedo はレンダー中に historyRef.current を読めないため、
  // 履歴を変えるたびに呼ばれる bumpHistoryVersion で state へ同期する。
  const [historyFlags, setHistoryFlags] = useState({
    canUndo: false,
    canRedo: false,
  });

  // ジェスチャ開始時に呼ばれ、次の変更前に「その時点」を履歴に積むためのフラグ
  const pendingHistorySnapshotRef = useRef<MeishiDocument | null>(null);

  // ジェスチャ系のライブ更新（setDocLive → setElementTransformLive）の
  // useCallback 依存に入るため参照を固定する。
  const bumpHistoryVersion = useCallback(
    () =>
      setHistoryFlags({
        canUndo: historyRef.current.past.length > 0,
        canRedo: historyRef.current.future.length > 0,
      }),
    [],
  );

  const reloadDocument = async () => {
    const library = await loadMeishiLibrary();
    // ライブラリを読み直した時点でのバインドを解決する。
    // 削除済みカードは未バインド（doc null）に落ちる。
    const card = fresh
      ? null
      : cardId
        ? library
          ? findCard(library, cardId)
          : null
        : library
          ? defaultCard(library)
          : null;
    setDoc(card?.document ?? null);
    setBoundCardId(card?.id ?? null);
    setLoaded(true);
    historyRef.current = emptyHistory();
    pendingHistorySnapshotRef.current = null;
    bumpHistoryVersion();
  };

  useEffect(() => {
    let cancelled = false;
    void loadMeishiLibrary().then((library) => {
      if (cancelled) return;
      const card = fresh
        ? null
        : cardId
          ? library
            ? findCard(library, cardId)
            : null
          : library
            ? defaultCard(library)
            : null;
      setDoc(card?.document ?? null);
      setBoundCardId(card?.id ?? null);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // ルートパラメータは画面の生存中変わらない前提（違うカードを開くときは
    // 別画面として push される）。cardId/fresh の変化での再読み込みはしない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 履歴を積むコミット
  const commit = (updater: (prev: MeishiDocument) => MeishiDocument) => {
    setDoc((prev) => {
      if (!prev) return prev;
      historyRef.current = commitHistory(historyRef.current, prev);
      bumpHistoryVersion();
      return updater(prev);
    });
  };

  // 履歴を積まないライブ更新（ジェスチャ中用）
  // setElementTransformLive 経由でジェスチャの useMemo 依存に入るため参照を固定する。
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

  // ジェスチャコールバック（edit.tsx の onTransform）の useCallback 依存に
  // 入るため参照を固定する。
  const beginGesture = useCallback(() => {
    // その時点の doc をスナップショット。次の setDocLive で履歴に積む。
    setDoc((prev) => {
      pendingHistorySnapshotRef.current = prev;
      return prev;
    });
  }, []);

  const replaceWithoutHistory = (next: MeishiDocument) => {
    historyRef.current = emptyHistory();
    bumpHistoryVersion();
    setDoc(next);
  };

  const undo = () => {
    setDoc((prev) => {
      if (!prev) return prev;
      const result = undoHistory(historyRef.current, prev);
      if (!result) return prev;
      historyRef.current = result.history;
      bumpHistoryVersion();
      return result.doc;
    });
  };

  const redo = () => {
    setDoc((prev) => {
      if (!prev) return prev;
      const result = redoHistory(historyRef.current, prev);
      if (!result) return prev;
      historyRef.current = result.history;
      bumpHistoryVersion();
      return result.doc;
    });
  };

  // 保存は「ライブラリ全体の read-modify-write」で行う。
  // updateMeishiLibrary のキューで一覧側の操作とも直列化されるので、
  // 編集中に他画面でカード操作が入っても保存が別カードを巻き戻さない。
  const saveDocument = async () => {
    if (!doc) return null;
    const currentDoc = doc;
    const { result } = await updateMeishiLibrary((library) => {
      if (boundCardId && findCard(library, boundCardId)) {
        return {
          library: updateCardDocument(library, boundCardId, currentDoc),
          result: null,
        };
      }
      // 未バインド（新規作成）or バインド先が消えていた場合は新規カードを作る。
      const added = addCard(library, currentDoc);
      return {
        library: added.library,
        result: { id: added.card.id, isFirst: library.cards.length === 0 },
      };
    });
    const newCardId = result?.id ?? null;
    // 初めての名刺の保存（issue #758）。保存のたびに送る meishi_save とは別に、
    // 名刺が 0 枚の状態から 1 枚目を作ったときだけ送る。
    if (result?.isFirst) trackEvent("meishi_create");
    if (newCardId) setBoundCardId(newCardId);
    return newCardId ?? boundCardId;
  };

  const updateElement = (id: string, patch: Partial<MeishiElement>) => {
    commit((prev) => ({
      ...prev,
      elements: prev.elements.map((el) =>
        el.id === id ? ({ ...el, ...patch } as MeishiElement) : el,
      ),
    }));
  };

  // ジェスチャコールバック（edit.tsx の onTransform）の useCallback 依存に
  // 入るため参照を固定する。
  const setElementTransformLive = useCallback(
    (id: string, transform: MeishiElement["transform"]) => {
      setDocLive((prev) => ({
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === id ? { ...el, transform } : el,
        ),
      }));
    },
    [setDocLive],
  );

  const addElement = (element: MeishiElement) => {
    commit((prev) => ({ ...prev, elements: [...prev.elements, element] }));
  };

  const removeElement = (id: string) => {
    commit((prev) => ({
      ...prev,
      elements: prev.elements.filter((el) => el.id !== id),
    }));
  };

  const duplicateElement = (id: string, newId: string) => {
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
  };

  const bringToFront = (id: string) => {
    commit((prev) => {
      const idx = prev.elements.findIndex((el) => el.id === id);
      if (idx < 0) return prev;
      const el = prev.elements[idx];
      const next = prev.elements.filter((e) => e.id !== id);
      next.push(el);
      return { ...prev, elements: next };
    });
  };

  const sendToBack = (id: string) => {
    commit((prev) => {
      const idx = prev.elements.findIndex((el) => el.id === id);
      if (idx < 0) return prev;
      const el = prev.elements[idx];
      const next = prev.elements.filter((e) => e.id !== id);
      next.unshift(el);
      return { ...prev, elements: next };
    });
  };

  const setBackground = (
    background: MeishiDocument["canvas"]["background"],
  ) => {
    commit((prev) => ({
      ...prev,
      canvas: { ...prev.canvas, background },
    }));
  };

  return {
    doc,
    loaded,
    boundCardId,
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
    canUndo: historyFlags.canUndo,
    canRedo: historyFlags.canRedo,
  };
}
