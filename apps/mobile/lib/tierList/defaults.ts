import type { TierRow } from "./types";

/** 新規に tier 表を作るときの初期 tier 行。*/
export const DEFAULT_TIERS: TierRow[] = [
  { key: "0", label: "S", color: "#ff0000" },
  { key: "1", label: "A", color: "#ff8000" },
  { key: "2", label: "B", color: "#ffff00" },
  { key: "3", label: "C", color: "#00ff00" },
  { key: "4", label: "D", color: "#0000ff" },
];

/**
 * 未分類（どの tier にも入れていない）作品を置くトレイのラベル。
 * トレイは tiers に含まれない暗黙の領域として扱う。
 */
export const UNASSIGNED_LABEL = "未分類";

/** 新規 tier 表の既定タイトル。シーズン表記から組み立てる。 */
export function defaultTierListTitle(season: string): string {
  const [year, name] = season.split("-");
  const jp: Record<string, string> = {
    winter: "冬",
    spring: "春",
    summer: "夏",
    autumn: "秋",
  };
  return `${year}年${jp[name ?? ""] ?? ""}アニメ Tier`;
}

/**
 * 新規キャラクター tier 表の既定タイトル（issue #169）。
 * 作品タイトルがまだ取れていない（通信前）ときは汎用の名前にする。
 * サーバのタイトル上限（50 文字）を超えると保存が常に 400 になり
 * 画面から回復できないため、長い作品タイトルは末尾から切り詰める。
 */
export function defaultCharacterTierListTitle(
  workTitle?: string | null,
): string {
  const TITLE_MAX_LENGTH = 50;
  const title = workTitle
    ? `${workTitle} キャラクターTier`
    : "キャラクター Tier 表";
  return title.length > TITLE_MAX_LENGTH
    ? title.slice(0, TITLE_MAX_LENGTH)
    : title;
}
