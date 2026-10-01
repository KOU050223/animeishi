// dアニメ視聴履歴インポートのコアロジック。
// framework 非依存・副作用なしの純粋な抽出・集約・検証・照合ロジックを集約する。
// Annict / API へのアクセスは呼び出し側が注入する（AnnictSearcher 参照）。
export * from "./types";
export * from "./concurrency";
export * from "./aggregate";
export * from "./extractScript";
export * from "./validate";
export * from "./titleNormalize";
export * from "./match";
