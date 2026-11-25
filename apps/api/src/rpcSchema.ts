import type { ExtractSchema } from "hono/types";
import type { routes } from "./app";

// 呼び出し結果の型を推論させ、d.ts に schema を展開して書かせる。
// mobile は生成物だけを読み、API のソースの型推論を繰り返さない（issue #725）。
const expand = <T>(v: T) => v;

export const rpcSchema = expand(
  null as unknown as ExtractSchema<typeof routes>,
);
