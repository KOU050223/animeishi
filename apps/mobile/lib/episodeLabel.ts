import type { WorkEpisode } from "@/lib/useWorkEpisodes";

// 話の表示名。「第3話」の numberText を優先し、無ければ話数・
// sortNumber から組み立てる（番外編など numberText/number が無い話向け）。
export function episodeLabel(episode: WorkEpisode): string {
  if (episode.numberText) return episode.numberText;
  if (episode.number != null) return `第${episode.number}話`;
  return `第${episode.sortNumber}話`;
}
