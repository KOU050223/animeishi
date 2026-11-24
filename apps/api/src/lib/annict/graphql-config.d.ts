// モジュール化しないと declare module が node_modules 側を上書きするため export {} を付ける。
export {};

declare module "gql.tada" {
  interface setupSchema {
    // fragment マスクは使わない（クエリ内に ...Fragment 展開を書かないため）。
    // 型導出用の fragment document の ResultOf を素の選択型にする。
    disableMasking: true;
    scalars: {
      // Annict の DateTime スカラーは ISO 8601 文字列として返る。
      DateTime: string;
    };
  }
}
