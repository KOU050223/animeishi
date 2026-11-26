/**
 * 距離（m）から体験上の近さの段階を決める純関数群（issue #698 試作）。
 * 閾値は issue #698 本文の「50cm 以下で弱、20cm 以下で中、10cm 以下で成立」に
 * 合わせる。
 */
export type ProximityLevel = "far" | "near" | "close" | "touch";

/** これ以下で交換成立とみなす距離（m）。 */
export const TOUCH_THRESHOLD_METERS = 0.1;

export function proximityLevel(meters: number | null): ProximityLevel {
  if (meters == null) return "far";
  if (meters <= TOUCH_THRESHOLD_METERS) return "touch";
  if (meters <= 0.2) return "close";
  if (meters <= 0.5) return "near";
  return "far";
}

export type HapticCue = "light" | "medium" | "strong" | "none";

/** near/close で継続して鳴らす触感の最小間隔。 */
export const HAPTIC_PULSE_INTERVAL_MS = 250;

const LEVEL_RANK: Record<ProximityLevel, number> = {
  far: 0,
  near: 1,
  close: 2,
  touch: 3,
};

/**
 * 相手 1 台ぶんのハプティクス状態機械。
 * - near: light を一定間隔で鳴らす
 * - close: medium を一定間隔で鳴らす
 * - touch: strong を突入時に 1 回だけ鳴らす（touch を外れると再武装する）
 * - 帯が強まった瞬間（near→close 等）は間隔を待たずに即座に鳴らす
 */
export type ProximityHaptics = {
  next: (meters: number | null, now: number) => HapticCue;
};

export function createProximityHaptics(): ProximityHaptics {
  let touchFired = false;
  let lastPulseAt = -Infinity;
  let lastCueRank = 0;
  return {
    next(meters, now) {
      const level = proximityLevel(meters);
      if (level === "touch") {
        if (touchFired) return "none";
        touchFired = true;
        lastCueRank = LEVEL_RANK.touch;
        return "strong";
      }
      touchFired = false;
      const cue =
        level === "close" ? "medium" : level === "near" ? "light" : null;
      if (cue == null) return "none";
      const escalated = LEVEL_RANK[level] > lastCueRank;
      if (!escalated && now - lastPulseAt < HAPTIC_PULSE_INTERVAL_MS) {
        return "none";
      }
      lastPulseAt = now;
      lastCueRank = LEVEL_RANK[level];
      return cue;
    },
  };
}
