// 実績（バッジ）の判定ロジック（issue #415）。D1・Annict への依存を
// 持たない純関数に分離し、境界値の振る舞いを単体テストで固定する。
import {
  WATCH_COUNT_TIERS,
  RECORD_STREAK_TIERS,
  achievementId,
  type AchievementKind,
} from "./definitions";

export type AchievementProgress = {
  current: number;
  // 目標値が取れない場合（今期の記録対象作品が無い等）は null。
  target: number | null;
};

export type Achievement = {
  id: string;
  kind: AchievementKind;
  // ティア閾値。season_completion など単発バッジは null。
  threshold: number | null;
  earned: boolean;
  // 判定に必要なデータが揃わなかったとき false（Annict 未連携で
  // 話数マスタを引けない等）。クライアントは「未連携」として表示できる。
  available: boolean;
  progress: AchievementProgress;
  // season_completion: 判定（または進捗表示）に使った作品。
  work?: { annictWorkId: number; title: string };
};

// ---- 週単位の連続記録 ----

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * JST 基準・月曜始まりの週インデックスを返す。
 * epoch（1970-01-01）は木曜なので、+3 日ずらすと週の先頭が月曜になる
 * （anime は週単位の放送サイクルなので月曜〜日曜で区切る）。
 */
export function jstWeekIndex(timestampMs: number): number {
  const dayIndex = Math.floor((timestampMs + JST_OFFSET_MS) / DAY_MS);
  return Math.floor((dayIndex + 3) / 7);
}

export type WeeklyStreakStats = {
  // 現在も続いている連続週数。今週まだ記録がなくても先週までが
  // 連続していれば「続いている」とみなす（週の途中で 0 に見えると
  // 月曜に必ず途切れた表示になってしまうため）。
  currentWeeks: number;
  // 過去の最長連続週数。獲得判定はこちらを使い、一度達した週数は
  // ストリークが切れても獲得済みを維持する。
  bestWeeks: number;
};

export function computeWeeklyStreak(
  recordedAts: readonly number[],
  nowMs: number,
): WeeklyStreakStats {
  const weeks = [...new Set(recordedAts.map(jstWeekIndex))].sort(
    (a, b) => a - b,
  );
  if (weeks.length === 0) return { currentWeeks: 0, bestWeeks: 0 };

  let run = 1;
  let best = 1;
  for (let i = 1; i < weeks.length; i++) {
    run = weeks[i]! === weeks[i - 1]! + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  const thisWeek = jstWeekIndex(nowMs);
  const lastWeek = weeks[weeks.length - 1]!;
  const alive = lastWeek === thisWeek || lastWeek === thisWeek - 1;
  let tail = 1;
  for (
    let i = weeks.length - 1;
    i > 0 && weeks[i]! === weeks[i - 1]! + 1;
    i--
  ) {
    tail += 1;
  }
  return { currentWeeks: alive ? tail : 0, bestWeeks: best };
}

// ---- 判定 ----

export function evaluateWatchCount(watchedCount: number): Achievement[] {
  return WATCH_COUNT_TIERS.map((threshold) => ({
    id: achievementId("watch_count", threshold),
    kind: "watch_count" as const,
    threshold,
    earned: watchedCount >= threshold,
    available: true,
    progress: { current: watchedCount, target: threshold },
  }));
}

export function evaluateRecordStreak(streak: WeeklyStreakStats): Achievement[] {
  return RECORD_STREAK_TIERS.map((threshold) => ({
    id: achievementId("record_streak", threshold),
    kind: "record_streak" as const,
    threshold,
    earned: streak.bestWeeks >= threshold,
    available: true,
    progress: { current: streak.currentWeeks, target: threshold },
  }));
}

// 今期の記録対象作品（D1 ログの集計結果）。同一話の複数記録は
// 呼び出し側で Set に畳み込んである。
export type SeasonCandidate = {
  annictWorkId: number;
  title: string;
  recordedEpisodeIds: ReadonlySet<number>;
};

// Annict episodes マスタ（話数マスタは Annict が正。issue #415 決定）。
export type SeasonEpisodeMaster = {
  annictWorkId: number;
  episodeIds: readonly number[];
};

/**
 * 今期完走の判定。「今期の作品を全話記録」は「今期放送の作品を 1 本でも
 * 全話記録したか」として評価し、進捗は最も完走に近い作品の n/全話数を返す。
 *
 * 話数マスタが取れていない作品（master 未取得・0 話作品）は候補から外す。
 * recorded が master に無い話 ID を含んでも比率は 1 を超えない
 * （master に含まれる話だけ数える）。
 */
export function evaluateSeasonCompletion(
  candidates: readonly SeasonCandidate[],
  masters: ReadonlyMap<number, SeasonEpisodeMaster>,
  available: boolean,
): Achievement {
  const base = {
    id: achievementId("season_completion", null),
    kind: "season_completion" as const,
    threshold: null,
    available,
  };
  if (!available) {
    return {
      ...base,
      earned: false,
      progress: { current: 0, target: null },
    };
  }

  let earned:
    | (Achievement & { work: { annictWorkId: number; title: string } })
    | null = null;
  let best: {
    work: SeasonCandidate;
    recorded: number;
    total: number;
    ratio: number;
  } | null = null;

  for (const work of candidates) {
    const master = masters.get(work.annictWorkId);
    if (!master || master.episodeIds.length === 0) continue;
    const total = master.episodeIds.length;
    let recorded = 0;
    for (const id of master.episodeIds) {
      if (work.recordedEpisodeIds.has(id)) recorded += 1;
    }
    if (recorded >= total) {
      earned = {
        ...base,
        earned: true,
        progress: { current: total, target: total },
        work: { annictWorkId: work.annictWorkId, title: work.title },
      };
      break;
    }
    const ratio = recorded / total;
    if (
      !best ||
      ratio > best.ratio ||
      (ratio === best.ratio && recorded > best.recorded)
    ) {
      best = { work, recorded, total, ratio };
    }
  }

  if (earned) return earned;
  return {
    ...base,
    earned: false,
    progress: best
      ? { current: best.recorded, target: best.total }
      : { current: 0, target: null },
    ...(best
      ? {
          work: {
            annictWorkId: best.work.annictWorkId,
            title: best.work.title,
          },
        }
      : {}),
  };
}
