// 実績（バッジ）の表示名・アイコン・「新規獲得」判定のヘルパー（issue #415）。
// 獲得判定自体は API（/me/achievements）が行い、ここは表示用の純関数だけを持つ。
import type { ComponentProps } from "react";
import type { Ionicons } from "@expo/vector-icons";
import type { TFunction } from "i18next";
import type {
  Achievement,
  AchievementKind,
  AchievementsResponse,
} from "./types";

type IconName = ComponentProps<typeof Ionicons>["name"];

/** 実績の表示名（「視聴 100 作品」「4 週連続記録」「今期完走」）。 */
export function achievementName(
  t: TFunction,
  achievement: Pick<Achievement, "kind" | "threshold">,
): string {
  switch (achievement.kind) {
    case "watch_count":
      // 段階情報が取れていない場合（API 未取得等）は段なしの汎称にする
      return achievement.threshold == null
        ? t("視聴数")
        : t("視聴 {{count}} 作品", { count: achievement.threshold });
    case "record_streak":
      return achievement.threshold == null
        ? t("連続記録")
        : t("{{count}} 週連続記録", { count: achievement.threshold });
    case "season_completion":
      return t("今期完走");
  }
}

export function achievementDescription(
  t: TFunction,
  kind: AchievementKind,
): string {
  switch (kind) {
    case "watch_count":
      return t("視聴済みにした作品の累計数");
    case "record_streak":
      return t("毎週なにか記録した週が続いた最長の連続週数");
    case "season_completion":
      return t("今期放送の作品の全話を記録する");
  }
}

export function achievementIconName(kind: AchievementKind): IconName {
  switch (kind) {
    case "watch_count":
      return "medal-outline";
    case "record_streak":
      return "flame-outline";
    case "season_completion":
      return "ribbon-outline";
  }
}

/**
 * 「既に確認済みか」を判定するキー。
 * 今期完走はシーズンごとに獲得し直せるため、シーズンを含めて別実績として
 * 扱う（次のシーズンで再度お祝いが出る）。
 */
export function achievementEarnedKey(
  achievement: Pick<Achievement, "id" | "kind">,
  season: string,
): string {
  return achievement.kind === "season_completion"
    ? `${achievement.id}@${season}`
    : achievement.id;
}

export function earnedAchievementKeys(
  response: Pick<AchievementsResponse, "achievements" | "season">,
): string[] {
  return response.achievements
    .filter((a) => a.earned)
    .map((a) => achievementEarnedKey(a, response.season));
}

/** 前回確認済みから新たに獲得した実績（お祝い表示の対象）。 */
export function diffNewlyEarned(
  response: Pick<AchievementsResponse, "achievements" | "season">,
  seenKeys: ReadonlySet<string>,
): Achievement[] {
  return response.achievements.filter(
    (a) => a.earned && !seenKeys.has(achievementEarnedKey(a, response.season)),
  );
}

/**
 * 既見キーに今回の獲得キーを和集合で足して返す。
 * 「今回獲得できたもの」で全置換しないのは、Annict 障害などで一時的に
 * 判定できなかった実績が既見から消え、復旧後に同じ実績を再度
 * お祝いしてしまうのを防ぐため。
 */
export function mergeSeenKeys(
  seenKeys: ReadonlySet<string>,
  earnedKeys: readonly string[],
): Set<string> {
  return new Set([...seenKeys, ...earnedKeys]);
}

/**
 * 名刺の実績バッジ要素に表示するラベル。
 * 獲得済みなら最高段の名前（例「視聴 100 作品」）、未獲得なら
 * 最初の段の名前に（未獲得）を付ける。データ未取得時も未獲得として出す。
 * kind は名刺ドキュメント由来の緩い文字列でも受けられるようにする。
 */
export function achievementBadgeLabel(
  t: TFunction,
  kind: AchievementKind,
  achievements: readonly {
    kind: string;
    threshold: number | null;
    earned: boolean;
  }[],
): string {
  const items = achievements
    .filter((a) => a.kind === kind)
    .sort((a, b) => (b.threshold ?? 0) - (a.threshold ?? 0));
  const earned = items.find((a) => a.earned);
  // 未獲得表示は最小閾値の段を使う（「視聴 10 作品（未獲得）」。
  // sort は降順なので末尾が最小）。
  const threshold = (earned ?? items[items.length - 1])?.threshold ?? null;
  const name = achievementName(t, { kind, threshold });
  return earned ? name : t("{{name}}（未獲得）", { name });
}

/** お祝い・実績一覧から共有シートへ渡すテキスト。 */
export function achievementShareMessage(
  t: TFunction,
  achievement: Pick<Achievement, "kind" | "threshold">,
): string {
  return t("アニ名刺で実績「{{name}}」を獲得したよ！ #アニ名刺", {
    name: achievementName(t, achievement),
  });
}
