import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { apiClient } from "@/lib/api";
import { ApiRequestError } from "@/lib/apiError";
import { buildAnnictAuthHeader, useAnnictConnection } from "@/lib/annict";
import type { TierItem } from "./types";

/**
 * キャラクター tier 表に並べる「作品のキャラクター一覧」を取得する
 * （issue #169）。
 *
 * サーバの GET /works/:annictWorkId/characters が Annict Work.casts を
 * プロキシし、キャラクター画像は AniList からの名寄せ結果を返す。
 * 画像が取れないキャラクターは imageUrl: null で来る（プレースホルダー描画）。
 */
export function useWorkCharacters(annictWorkId: number | null) {
  const { getToken, isSignedIn } = useAuth();
  const { isConnected, isLoading: isConnectionLoading } = useAnnictConnection();

  const query = useQuery({
    queryKey: ["character-tier-list", "work-characters", annictWorkId] as const,
    enabled: !!isSignedIn && isConnected && annictWorkId != null,
    queryFn: async () => {
      const token = await getToken();
      if (!token) throw new Error("認証トークンが取得できませんでした");
      const annictHeader = await buildAnnictAuthHeader();
      const res = await apiClient.works[":annictWorkId"].characters.$get(
        { param: { annictWorkId: String(annictWorkId) } },
        {
          headers: { Authorization: `Bearer ${token}`, ...annictHeader },
        },
      );
      if (!res.ok) {
        throw new ApiRequestError(
          res.status,
          "キャラクター一覧の取得に失敗しました",
        );
      }
      return res.json();
    },
  });

  const characters = useMemo<TierItem[]>(
    () =>
      (query.data?.characters ?? []).map((c) => ({
        id: c.annictCharacterId,
        title: c.name,
        imageUrl: c.imageUrl,
      })),
    [query.data],
  );

  return {
    characters,
    /** 対象作品のタイトル（ヘッダ表示用）。未取得時は null。 */
    workTitle: query.data?.work.title ?? null,
    isLoading: query.isLoading,
    // バックグラウンド再取得が失敗しても既存データがあるなら盤面を維持する
    // （isError をそのまま見ると、表示中の編集済み盤面がエラー表示に変わる）。
    isError: query.isError && characters.length === 0,
    isConnected,
    isConnectionLoading,
  };
}
