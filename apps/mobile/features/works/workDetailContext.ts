import { createContext, useContext } from "react";
import type { WorkDetailSheetTarget } from "@/components/anime-list/AnimeWorkDetailSheet";

export type WorkDetailTarget = Pick<
  WorkDetailSheetTarget,
  "annictWorkId" | "title"
> & {
  // Partial だと exactOptionalPropertyTypes 下で undefined の明示代入を
  // 許さないため、各プロパティに | undefined を足した同等の形にする。
  [K in Exclude<keyof WorkDetailSheetTarget, "annictWorkId" | "title">]?:
    | WorkDetailSheetTarget[K]
    | undefined;
};

export const WorkDetailContext = createContext<
  (work: WorkDetailTarget) => void
>(() => {});

export function useOpenWorkDetail() {
  return useContext(WorkDetailContext);
}
