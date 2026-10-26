import type { Env, Hono } from "hono";
import { handleError } from "@/observability";

// ルートテスト用の app 組み立て。index.ts と同じ app.onError(handleError) を
// 掛けて、AnnictApiError → 401/502・未処理例外 → 500 JSON の変換を
// 本番と同じ振る舞いにする。
export function applyApiErrorHandling<E extends Env>(app: Hono<E>): Hono<E> {
  app.onError(handleError);
  return app;
}
