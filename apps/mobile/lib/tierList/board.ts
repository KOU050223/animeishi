import type { TierAssignment, TierRow, TierItem } from "./types";

/**
 * tier 表の状態遷移を担う純粋関数群。
 * ドラッグ&ドロップの UI から切り離しておくことで、ジェスチャを再現せずに
 * 「落とした結果どうなるか」をテストできる。
 *
 * 作品・キャラクターどちらの tier 表でも使う（issue #169）。そのため
 * ここでは対象を「アイテム」（TierItem.id で識別）として扱い、
 * annictWorkId / annictCharacterId への対応づけは呼び出し側が行う。
 */

/**
 * アイテムを指定 tier に配置する。既に別の tier にいた場合は移動になる。
 * tierKey に null を渡すと未分類（トレイ）へ戻す。
 */
export function assignItem(
  assignment: TierAssignment,
  itemId: number,
  tierKey: string | null,
): TierAssignment {
  const next = new Map(assignment);
  // Map.set は既存キーの挿入位置を保つため、いったん消してから追加し直す。
  // そうしないと「別 tier に移して戻す」で元の位置に残り、
  // 新規配置は末尾追加という約束と表示順・保存順がずれる。
  next.delete(itemId);
  if (tierKey !== null) {
    next.set(itemId, tierKey);
  }
  return next;
}

/**
 * 指定 tier に配置されたアイテムを、配置順（＝サーバから返る position 順、
 * 新規配置は末尾追加）で返す。
 *
 * Map は挿入順を保つため、この順序がそのまま表示順になる。
 * ドロップは常に末尾追加なので、行内の任意位置への挿入は v1 では扱わない。
 */
export function itemsInTier(
  items: TierItem[],
  assignment: TierAssignment,
  tierKey: string,
): TierItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const result: TierItem[] = [];
  for (const [itemId, key] of assignment) {
    if (key !== tierKey) continue;
    const item = byId.get(itemId);
    if (item) result.push(item);
  }
  return result;
}

/**
 * どの tier にも配置されていないアイテム（未分類トレイの中身）を返す。
 * 全件から配置済みを引いた差分なので、アイテム一覧が増えれば自動で追随する。
 */
export function unassignedItems(
  items: TierItem[],
  assignment: TierAssignment,
): TierItem[] {
  return items.filter((item) => !assignment.has(item.id));
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
  for (const [itemId, key] of assignment) {
    if (!keys.has(key)) next.delete(itemId);
  }
  return next;
}

/**
 * 保存 API へ送る items 配列を組み立てる。
 * position はサーバが配列順から採番するため送らない。tier ごとにまとめて
 * 並べることで、サーバ採番の position が行内の表示順と一致する。
 *
 * 返す ID は汎用の itemId。作品なら annictWorkId、キャラクターなら
 * annictCharacterId へのフィールド名の写像は呼び出し側で行う
 * （PUT /me/tier-lists と PUT /me/character-tier-lists で受け取る
 * フィールド名が違うため）。
 */
export function toSaveItems(
  assignment: TierAssignment,
  tiers: TierRow[],
): { itemId: number; tierKey: string }[] {
  const items: { itemId: number; tierKey: string }[] = [];
  for (const tier of tiers) {
    for (const [itemId, key] of assignment) {
      if (key === tier.key) items.push({ itemId, tierKey: key });
    }
  }
  return items;
}

/**
 * tier 表の盤面スナップショット。保存 API に送る形（items は汎用の
 * itemId 表記で、toSaveItems の出力そのもの）。
 */
export type BoardSnapshot = {
  title: string;
  tiers: TierRow[];
  items: { itemId: number; tierKey: string }[];
};

/**
 * 2 つの盤面スナップショットが一致するか（title・tiers・配置の順序まで比較）。
 * 保存の成功コールバックは送信時点の state を掴むため、保存中に進んだ
 * 編集を「保存済み」に誤認しないよう、送信した盤面と現在の盤面が
 * 一致するときだけ isDirty を解除する判定に使う。
 */
export function sameBoard(a: BoardSnapshot, b: BoardSnapshot): boolean {
  if (a.title !== b.title) return false;
  if (a.tiers.length !== b.tiers.length) return false;
  for (let i = 0; i < a.tiers.length; i += 1) {
    const x = a.tiers[i];
    const y = b.tiers[i];
    if (x.key !== y.key || x.label !== y.label || x.color !== y.color) {
      return false;
    }
  }
  if (a.items.length !== b.items.length) return false;
  for (let i = 0; i < a.items.length; i += 1) {
    if (a.items[i].itemId !== b.items[i].itemId) return false;
    if (a.items[i].tierKey !== b.items[i].tierKey) return false;
  }
  return true;
}

/** サーバから返る items（position 昇順）を TierAssignment に戻す。 */
export function toAssignment(
  items: { itemId: number; tierKey: string }[],
): TierAssignment {
  return new Map(items.map((i) => [i.itemId, i.tierKey]));
}

/**
 * サーバの tiers_json を TierRow[] に戻す。
 * 壊れた JSON（手動編集・スキーマ変更の取りこぼし）で画面全体が落ちないよう、
 * パース不能なら null を返して呼び出し側で既定値へフォールバックさせる。
 */
export function parseTiersJson(json: string): TierRow[] | null {
  const isTierRow = (r: unknown): r is TierRow =>
    typeof r === "object" &&
    r !== null &&
    typeof (r as TierRow).key === "string" &&
    typeof (r as TierRow).label === "string" &&
    typeof (r as TierRow).color === "string";
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    // 不正な行だけを捨てると、その行に置かれていたアイテムが表示も保存も
    // されずに消える。1 行でも壊れていれば全体を既定値にフォールバックする。
    if (parsed.length === 0 || !parsed.every(isTierRow)) return null;
    return parsed;
  } catch {
    return null;
  }
}
