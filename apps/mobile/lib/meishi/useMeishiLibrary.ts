import { useCallback, useEffect, useRef, useState } from "react";
import {
  addCard as addCardOp,
  defaultCard,
  duplicateCard as duplicateCardOp,
  emptyLibrary,
  removeCard as removeCardOp,
  setDefaultCard,
  updateCardDocument as updateCardDocumentOp,
} from "./library";
import { loadMeishiLibrary, saveMeishiLibrary } from "./storage";
import type { MeishiCardData, MeishiDocument, MeishiLibrary } from "./types";

/**
 * 複数名刺（issue #427）のライブラリ状態管理。
 * カードの追加・複製・削除・既定切替を library.ts の純粋な操作に流し、
 * 変更のたび AsyncStorage へ保存する。
 *
 * 最新のライブラリは ref にもミラーする。各操作は state の更新関数経由では
 * なく ref 起点の read-modify-write にすることで、連続した操作（複製→削除
 * 等）が同じスナップショットを潰し合わないようにしている。
 */
export function useMeishiLibrary() {
  const [library, setLibrary] = useState<MeishiLibrary>(emptyLibrary());
  const [loaded, setLoaded] = useState(false);
  const libraryRef = useRef<MeishiLibrary>(library);

  const persist = useCallback(async (next: MeishiLibrary) => {
    libraryRef.current = next;
    setLibrary(next);
    await saveMeishiLibrary(next);
  }, []);

  const reload = useCallback(async () => {
    const persisted = await loadMeishiLibrary();
    const next = persisted ?? emptyLibrary();
    libraryRef.current = next;
    setLibrary(next);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMeishiLibrary().then((persisted) => {
      if (cancelled) return;
      const next = persisted ?? emptyLibrary();
      libraryRef.current = next;
      setLibrary(next);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const addCard = useCallback(
    async (document: MeishiDocument): Promise<MeishiCardData> => {
      const result = addCardOp(libraryRef.current, document);
      await persist(result.library);
      return result.card;
    },
    [persist],
  );

  const duplicateCard = useCallback(
    async (id: string): Promise<MeishiCardData | null> => {
      const result = duplicateCardOp(libraryRef.current, id);
      if (!result) return null;
      await persist(result.library);
      return result.card;
    },
    [persist],
  );

  const removeCard = useCallback(
    async (id: string) => {
      await persist(removeCardOp(libraryRef.current, id));
    },
    [persist],
  );

  const setDefault = useCallback(
    async (id: string) => {
      await persist(setDefaultCard(libraryRef.current, id));
    },
    [persist],
  );

  const updateCardDocument = useCallback(
    async (id: string, document: MeishiDocument) => {
      await persist(updateCardDocumentOp(libraryRef.current, id, document));
    },
    [persist],
  );

  return {
    library,
    loaded,
    cards: library.cards,
    defaultCard: defaultCard(library),
    reload,
    addCard,
    duplicateCard,
    removeCard,
    setDefault,
    updateCardDocument,
  };
}

export type UseMeishiLibrary = ReturnType<typeof useMeishiLibrary>;
