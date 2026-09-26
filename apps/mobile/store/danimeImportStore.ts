// 取込画面（WebView / ブックマークレット貼り付け）で得た抽出結果を
// レビュー画面へ渡すための一時ストア。永続化しない（画面遷移中のみ有効）。
import { create } from "zustand";
import type { DanimeExtractedLists } from "@/lib/danime/types";

type DanimeImportStore = {
  lists: DanimeExtractedLists | null;
  setLists: (lists: DanimeExtractedLists | null) => void;
};

export const useDanimeImportStore = create<DanimeImportStore>((set) => ({
  lists: null,
  setLists: (lists) => set({ lists }),
}));
