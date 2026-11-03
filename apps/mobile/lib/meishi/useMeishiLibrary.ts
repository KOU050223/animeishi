import { useCallback, useEffect, useState } from "react";
import {
  addCard as addCardOp,
  defaultCard,
  duplicateCard as duplicateCardOp,
  emptyLibrary,
  removeCard as removeCardOp,
  setDefaultCard,
  updateCardDocument as updateCardDocumentOp,
} from "./library";
import {
  loadMeishiLibrary,
  updateMeishiLibrary,
  type MeishiLibraryUpdate,
} from "./storage";
import type { MeishiCardData, MeishiDocument, MeishiLibrary } from "./types";

/**
 * 複数名刺（issue #427）のライブラリ状態管理。
 * カードの追加・複製・削除・既定切替は updateMeishiLibrary 経由で
 * 「最新の保存状態を読む→純粋な操作を適用→書き戻す」を直列化して行う。
 * state は保存が確定したライブラリの写しにする。操作完了前に楽観更新
 * すると、連続操作時に画面だけ先に進んで保存結果とずれうるため。
 */
export function useMeishiLibrary() {
  const [library, setLibrary] = useState<MeishiLibrary>(() => emptyLibrary());
  const [loaded, setLoaded] = useState(false);

  const applyUpdate = useCallback(
    async <T>(updater: (lib: MeishiLibrary) => MeishiLibraryUpdate<T>) => {
      const { library: next, result } = await updateMeishiLibrary(updater);
      setLibrary(next);
      return result;
    },
    [],
  );

  const reload = useCallback(async () => {
    const persisted = await loadMeishiLibrary();
    setLibrary(persisted ?? emptyLibrary());
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMeishiLibrary().then((persisted) => {
      if (cancelled) return;
      setLibrary(persisted ?? emptyLibrary());
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const addCard = useCallback(
    (document: MeishiDocument): Promise<MeishiCardData> =>
      applyUpdate((lib) => {
        const r = addCardOp(lib, document);
        return { library: r.library, result: r.card };
      }),
    [applyUpdate],
  );

  const duplicateCard = useCallback(
    (id: string): Promise<MeishiCardData | null> =>
      applyUpdate((lib) => {
        const r = duplicateCardOp(lib, id);
        return {
          library: r ? r.library : lib,
          result: r ? r.card : null,
        };
      }),
    [applyUpdate],
  );

  const removeCard = useCallback(
    (id: string) =>
      applyUpdate((lib) => ({
        library: removeCardOp(lib, id),
        result: undefined,
      })),
    [applyUpdate],
  );

  const setDefault = useCallback(
    (id: string) =>
      applyUpdate((lib) => ({
        library: setDefaultCard(lib, id),
        result: undefined,
      })),
    [applyUpdate],
  );

  const updateCardDocument = useCallback(
    (id: string, document: MeishiDocument) =>
      applyUpdate((lib) => ({
        library: updateCardDocumentOp(lib, id, document),
        result: undefined,
      })),
    [applyUpdate],
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
