/**
 * tier 表のクライアント側モデル。
 *
 * サーバは tiers を JSON 文字列（tiers_json）で持つため、境界で parse/stringify する。
 * 型定義をここに集約して、画面・フック・コンポーネントが同じ形を共有する。
 */

/** tier 表の 1 行（S / A / B ...）。 */
export type TierRow = {
  /** 配置（TierAssignment）から参照される識別子。ラベルを変えても壊れないよう別に持つ。 */
  key: string;
  /** 行ヘッダに表示するラベル。ユーザーが自由に変更できる。 */
  label: string;
  /** 行ヘッダの背景色（#RRGGBB）。 */
  color: string;
};

/**
 * 「どの作品がどの tier にいるか」の割り当て。
 * key は annictWorkId、value は TierRow.key。
 * 未配置の作品はここにエントリを持たない（＝未分類トレイに残る）。
 *
 * 配列ではなく Map にしているのは、ドラッグ中に「この作品は今どこか」を
 * O(1) で引く必要があり、かつ行の並び順は tiers 側が持っているため。
 */
export type TierAssignment = Map<number, string>;

/** tier 表に並べる作品の最小形。/works/search と保存済み表の両方から作れる。 */
export type TierWork = {
  annictWorkId: number;
  title: string;
  imageUrl?: string | null;
  resolvedImageUrl?: string | null;
};

/** 画面が保持する編集中の tier 表の状態。 */
export type TierBoard = {
  season: string;
  title: string;
  tiers: TierRow[];
  assignment: TierAssignment;
};
