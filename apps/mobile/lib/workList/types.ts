/**
 * オリジナル作品リスト（issue #349）のクライアント側モデル。
 * サーバの items は作品メタを含むが、画面が並べ替え・表示に使うのは
 * この最小形（TierItem と同じ構造。作品検索シートの onAdd と型を揃える）。
 */
export type WorkListEntry = {
  /** annictWorkId。 */
  id: number;
  title: string;
  /** 作品画像プロキシの URL（GET /images/works/:id の hostedImageUrl）。 */
  imageUrl: string | null;
};
