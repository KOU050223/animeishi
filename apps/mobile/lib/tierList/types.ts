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
 * 「どのアイテムがどの tier にいるか」の割り当て。
 * key はアイテム ID（作品なら annictWorkId、キャラクターなら annictCharacterId）、
 * value は TierRow.key。未配置のアイテムはここにエントリを持たない
 * （＝未分類トレイに残る）。
 *
 * 配列ではなく Map にしているのは、ドラッグ中に「このアイテムは今どこか」を
 * O(1) で引く必要があり、かつ行の並び順は tiers 側が持っているため。
 */
export type TierAssignment = Map<number, string>;

/**
 * tier 表に並べる対象の最小形（issue #169 で作品→汎用アイテムに拡張）。
 * 作品モードでは /works/search や保存済み表から、キャラクターモードでは
 * /works/:id/characters や保存済みキャラクター表から作れる。
 */
export type TierItem = {
  /** 並べる対象の ID。作品なら annictWorkId、キャラクターなら annictCharacterId。 */
  id: number;
  title: string;
  /**
   * 表示用の画像 URL。作品なら API の作品画像プロキシ URL
   * （GET /images/works/:id の hostedImageUrl）、キャラクターなら Annict の画像。
   * 外部 URL への切り替えはしない（issue #224）。
   */
  imageUrl?: string | null;
};

/** 画面が保持する編集中の tier 表の状態。 */
export type TierBoard = {
  season: string;
  title: string;
  tiers: TierRow[];
  assignment: TierAssignment;
};
