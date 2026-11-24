// Annict GraphQL API / OAuth トークンエンドポイントへの薄いクライアント。
// issue #733 でクエリ種別ごとのファイルに分け、このファイルが窓口として
// まとめて再エクスポートする。
//
// 設計方針（docs/05）:
// - モバイルに GraphQL を持ち込まず、Workers が唯一の Annict 通信点になる。
// - Annict トークンはサーバー非保存。リクエストごとに呼び出し側から渡す。
// - PR2 ではクライアントの土台と OAuth 交換のみ。libraryEntries / updateStatus を
//   叩く高レベル関数は PR3 / PR4 で足す。
export * from "./graphql";
export * from "./workNodes";
export * from "./seasons";
export * from "./library";
export * from "./workSearch";
export * from "./workDetail";
export * from "./workCasts";
export * from "./episodes";
export * from "./records";
export * from "./oauth";
