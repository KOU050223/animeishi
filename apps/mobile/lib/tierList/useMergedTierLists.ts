import { useMemo } from "react";
import { useTierLists } from "./useTierList";
import { useCharacterTierLists } from "./useCharacterTierList";
import { useCustomTierLists } from "./useCustomTierList";

// tier 表 3 種類（シーズン・キャラ・自由）を 1 つの一覧として扱うための
// 共通型とフック（issue #352）。ひろばの横スクロールとハブ画面
// （/tier-lists）で同じ並びを出すためにまとめている。
export type TierListKind = "season" | "character" | "custom";

export const TIER_KIND_LABELS: Record<TierListKind, string> = {
  season: "シーズン",
  character: "キャラ",
  custom: "自由",
};

export type MergedTierListItem = {
  key: string;
  kind: TierListKind;
  /** 編集画面へ渡す識別子。season は "2026-spring"、character は
      annictWorkId、custom は id（いずれも文字列化）。 */
  id: string;
  title: string;
  shared: boolean;
  /** ひろばの公開一覧に載せる設定（issue #476）。一覧の「公開中」表示に使う。 */
  isPublic: boolean;
  updatedAt: string;
};

/**
 * 自分の tier 表 3 種類を更新日時の新しい順に混ぜた一覧。
 * 各一覧クエリの isLoading / isError は「どれか 1 つでも」で合成する
 * （部分的に表示すると更新日時順が崩れて見えるため）。
 */
export function useMergedTierLists() {
  const seasonLists = useTierLists();
  const characterLists = useCharacterTierLists();
  const customLists = useCustomTierLists();

  const items = useMemo<MergedTierListItem[]>(() => {
    const merged: MergedTierListItem[] = [
      ...(seasonLists.data ?? []).map((l) => ({
        key: `season-${l.season}`,
        kind: "season" as const,
        id: l.season,
        title: l.title,
        shared: l.shareToken != null,
        isPublic: l.isPublic,
        // API の updatedAt は ISO 8601 文字列。文字列比較で新旧順になる。
        updatedAt: String(l.updatedAt),
      })),
      ...(characterLists.data ?? []).map((l) => ({
        key: `character-${l.annictWorkId}`,
        kind: "character" as const,
        id: String(l.annictWorkId),
        title: l.title,
        shared: l.shareToken != null,
        isPublic: l.isPublic,
        updatedAt: String(l.updatedAt),
      })),
      ...(customLists.data ?? []).map((l) => ({
        key: `custom-${l.id}`,
        kind: "custom" as const,
        id: String(l.id),
        title: l.title,
        shared: l.shareToken != null,
        isPublic: l.isPublic,
        updatedAt: String(l.updatedAt),
      })),
    ];
    merged.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return merged;
  }, [seasonLists.data, characterLists.data, customLists.data]);

  return {
    items,
    isLoading:
      seasonLists.isLoading ||
      characterLists.isLoading ||
      customLists.isLoading,
    isError:
      seasonLists.isError || characterLists.isError || customLists.isError,
  };
}
