import { useMemo } from "react";
import { buildMeishiAnimeContext } from "./animeContext";
import type { MeishiRenderContext } from "./types";
import { useFavorites } from "@/lib/useFavorites";
import { useWatchHistory } from "@/lib/useWatchHistory";

/**
 * 名刺の描画コンテキストを組み立てる。プロフィールに加えて、
 * コラージュ・カウントバッジが参照するお気に入り / 視聴履歴を載せる。
 * 画面表示（MeishiCard）と共有画像スナップショットで同じコンテキストを
 * 使えるよう共通化している。
 */
export function useMeishiRenderContext(
  profile: MeishiRenderContext["profile"],
): MeishiRenderContext {
  const { data: favorites } = useFavorites();
  const { data: watchHistory } = useWatchHistory();

  return useMemo<MeishiRenderContext>(
    () => ({
      profile,
      ...buildMeishiAnimeContext({ favorites, watchHistory }),
    }),
    [profile, favorites, watchHistory],
  );
}
