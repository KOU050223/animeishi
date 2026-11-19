import { createContext, useContext } from "react";
import type { WorkDetailSheetTarget } from "@/components/anime-list/AnimeWorkDetailSheet";

export type WorkDetailTarget = Pick<
  WorkDetailSheetTarget,
  "annictWorkId" | "title"
> &
  Partial<Omit<WorkDetailSheetTarget, "annictWorkId" | "title">>;

export const WorkDetailContext = createContext<
  (work: WorkDetailTarget) => void
>(() => {});

export function useOpenWorkDetail() {
  return useContext(WorkDetailContext);
}
