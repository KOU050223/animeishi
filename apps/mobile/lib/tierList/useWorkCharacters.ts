import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/expo";
import { tierListQueries } from "@/lib/queries/tierLists";
import { useWorkCatalogAccess } from "@/lib/annict";
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
  const { isSignedIn } = useAuth();
  const { canBrowseWorks, isLoading: isAccessLoading } = useWorkCatalogAccess();

  const query = useQuery({
    ...tierListQueries.workCharacters.query({ annictWorkId }),
    enabled: !!isSignedIn && canBrowseWorks && annictWorkId != null,
  });

  // サーバーはキャラクター名簿を annictCharacterId で dedupe 済みだが、
  // 同じ id が複数届いた場合でも盤面に 1 件しか出ないよう、
  // 表示の境界（TierBoard）で潰す（issue #521）。
  // TierBoard のジェスチャ系 useCallback の依存（boardItems）まで
  // 連なる参照を固定するため手動メモ化を残す。
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
    canBrowseWorks,
    isAccessLoading,
  };
}
