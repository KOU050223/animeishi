import type { TierAssignment, TierRow, TierWork } from "./types";

/**
 * tier 表の状態遷移を担う純粋関数群。
 * ドラッグ&ドロップの UI から切り離しておくことで、ジェスチャを再現せずに
 * 「落とした結果どうなるか」をテストできる。
 */

/**
 * 作品を指定 tier に配置する。既に別の tier にいた場合は移動になる。
 * tierKey に null を渡すと未分類（トレイ）へ戻す。
 */
export function assignWork(
  assignment: TierAssignment,
  annictWorkId: number,
  tierKey: string | null,
): TierAssignment {
  const next = new Map(assignment);
  if (tierKey === null) {
    next.delete(annictWorkId);
  } else {
    next.set(annictWorkId, tierKey);
  }
  return next;
}

/**
 * 指定 tier に配置された作品を、配置順（＝サーバから返る position 順、
 * 新規配置は末尾追加）で返す。
 *
 * Map は挿入順を保つため、この順序がそのまま表示順になる。
 * ドロップは常に末尾追加なので、行内の任意位置への挿入は v1 では扱わない。
 */
export function worksInTier(
  works: TierWork[],
  assignment: TierAssignment,
  tierKey: string,
): TierWork[] {
  const byId = new Map(works.map((w) => [w.annictWorkId, w]));
  const result: TierWork[] = [];
  for (const [workId, key] of assignment) {
    if (key !== tierKey) continue;
    const work = byId.get(workId);
    if (work) result.push(work);
  }
  return result;
}

/**
 * どの tier にも配置されていない作品（未分類トレイの中身）を返す。
 * シーズン全作品から配置済みを引いた差分なので、作品一覧が増えれば自動で追随する。
 */
export function unassignedWorks(
  works: TierWork[],
  assignment: TierAssignment,
): TierWork[] {
  return works.filter((w) => !assignment.has(w.annictWorkId));
}

/**
 * tiers の定義から消えた tier に取り残された配置を落とす。
 * 行を削除したときに「どこにも描画されない幽霊配置」が残ると、
 * 保存時にサーバの refine で 400 になるため、削除の時点で掃除する。
 */
export function pruneAssignment(
  assignment: TierAssignment,
  tiers: TierRow[],
): TierAssignment {
  const keys = new Set(tiers.map((t) => t.key));
  const next = new Map(assignment);
  for (const [workId, key] of assignment) {
    if (!keys.has(key)) next.delete(workId);
  }
  return next;
}

/**
 * 保存 API（PUT /me/tier-lists）へ送る items 配列を組み立てる。
 * position はサーバが配列順から採番するため送らない。tier ごとにまとめて
 * 並べることで、サーバ採番の position が行内の表示順と一致する。
 */
export function toSaveItems(
  assignment: TierAssignment,
  tiers: TierRow[],
): { annictWorkId: number; tierKey: string }[] {
  const items: { annictWorkId: number; tierKey: string }[] = [];
  for (const tier of tiers) {
    for (const [workId, key] of assignment) {
      if (key === tier.key) items.push({ annictWorkId: workId, tierKey: key });
    }
  }
  return items;
}

/** サーバから返る items（position 昇順）を TierAssignment に戻す。 */
export function toAssignment(
  items: { annictWorkId: number; tierKey: string }[],
): TierAssignment {
  return new Map(items.map((i) => [i.annictWorkId, i.tierKey]));
}

/**
 * サーバの tiers_json を TierRow[] に戻す。
 * 壊れた JSON（手動編集・スキーマ変更の取りこぼし）で画面全体が落ちないよう、
 * パース不能なら null を返して呼び出し側で既定値へフォールバックさせる。
 */
export function parseTiersJson(json: string): TierRow[] | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    const rows = parsed.filter(
      (r): r is TierRow =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as TierRow).key === "string" &&
        typeof (r as TierRow).label === "string" &&
        typeof (r as TierRow).color === "string",
    );
    return rows.length > 0 ? rows : null;
  } catch {
    return null;
  }
}
