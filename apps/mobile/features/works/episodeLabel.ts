import type { TFunction } from "i18next";
import type { WorkEpisode } from "@/features/works/useWorkEpisodes";

// 話の表示名。「第3話」の numberText を優先し、無ければ話数・
// sortNumber から組み立てる（番外編など numberText/number が無い話向け）。
export function episodeLabel(episode: WorkEpisode, t: TFunction): string {
  if (episode.numberText) return episode.numberText;
  if (episode.number != null)
    return t("第{{count}}話", { count: episode.number });
  return t("第{{count}}話", { count: episode.sortNumber });
}
