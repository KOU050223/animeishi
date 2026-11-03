import { useMemo } from "react";
import { buildMeishiAnimeContext } from "./animeContext";
import type { MeishiRenderContext } from "./types";
import { useAchievements } from "@/lib/achievements/useAchievements";
import { useFavorites } from "@/lib/useFavorites";
import { useWatchHistory } from "@/lib/useWatchHistory";

/**
 * 名刺の描画コンテキストを組み立てる。プロフィールに加えて、
 * コラージュ・カウントバッジが参照するお気に入り / 視聴履歴と、
 * 実績バッジが参照する獲得状況を載せる。
 * 画面表示（MeishiCard）と共有画像スナップショットで同じコンテキストを
 * 使えるよう共通化している。
 */
export function useMeishiRenderContext(
  profile: MeishiRenderContext["profile"],
): MeishiRenderContext {
  const { data: favorites } = useFavorites();
  const { data: watchHistory } = useWatchHistory();
  const { data: achievements } = useAchievements();

  return useMemo<MeishiRenderContext>(
    () => ({
      profile,
      ...buildMeishiAnimeContext({ favorites, watchHistory }),
      achievements: achievements?.achievements,
    }),
    [profile, favorites, watchHistory, achievements],
  );
}
