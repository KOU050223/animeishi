import { featureFlags } from "@/lib/featureFlags";
import { useMyTierLists } from "./useTierList";

// tier 表 3 種類（シーズン・キャラ・自由）を 1 つの一覧として扱うための
// 共通型とフック（issue #352、#724 で API を 1 モデルに統合）。
// ひろばの横スクロールとハブ画面（/tier-lists）で同じ並びを出すために
// まとめている。
import type { TranslationKey } from "@/lib/i18n/keys";

export type TierListKind = "season" | "character" | "custom";

export const TIER_KIND_LABELS: Record<TierListKind, TranslationKey> = {
  season: "シーズン",
  character: "キャラ",
  custom: "自由",
};

/**
 * 機能フラグで有効な kind か（issue #724）。
 * 無効な kind は作成選択肢にも一覧にも出さない（シーズン版のみが
 * 既定の公開範囲。character / custom は機能フラグで段階的に開く）。
 */
export function isTierListKindEnabled(kind: TierListKind): boolean {
  if (kind === "character") return featureFlags.characterTierList;
  if (kind === "custom") return featureFlags.customTierList;
  return true;
}

export type MergedTierListItem = {
  key: string;
  kind: TierListKind;
  /** tier_lists.id。編集画面・削除・共有の対象指定に使う。 */
  id: number;
  /** 編集画面へ渡すスコープ値。season は "2026-spring"、character は
      annictWorkId。custom はスコープを持たず null。 */
  season: string | null;
  annictWorkId: number | null;
  title: string;
  shared: boolean;
  /** ひろばの公開一覧に載せる設定（issue #476）。一覧の「公開中」表示に使う。 */
  isPublic: boolean;
  updatedAt: string;
};

/**
 * 自分の tier 表を更新日時の新しい順に並べた一覧。
 * 機能フラグで無効な kind は混ぜない（既定ではシーズン版だけが見える）。
 */
export function useMergedTierLists() {
  const lists = useMyTierLists();

  const items: MergedTierListItem[] = (lists.data ?? [])
    .filter((l) => isTierListKindEnabled(l.kind))
    .map((l) => ({
      key: `${l.kind}-${l.id}`,
      kind: l.kind,
      id: l.id,
      season: l.season,
      annictWorkId: l.annictWorkId,
      title: l.title,
      shared: l.shareToken != null,
      isPublic: l.isPublic,
      // API の updatedAt は ISO 8601 文字列。文字列比較で新旧順になる。
      updatedAt: String(l.updatedAt),
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return { items, isLoading: lists.isLoading, isError: lists.isError };
}
