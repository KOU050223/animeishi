import type { Context } from "hono";
import { AnnictApiError } from "@/lib/annict/client";

// Annict 通信エラーをクライアント向けレスポンスへ変換する。
// 401（トークン失効・スコープ不足）は再連携を促し、それ以外の Annict 由来障害は
// 502（上流障害）として返す。Annict 由来でなければ null を返し、呼び出し側で再 throw する。
export function annictErrorResponse(c: Context, err: unknown) {
  if (err instanceof AnnictApiError) {
    if (err.status === 401) {
      return c.json(
        { error: "Annict 連携が無効です", code: "annict_token_invalid" },
        401,
      );
    }
    return c.json(
      { error: "Annict との通信に失敗しました", code: "annict_upstream" },
      502,
    );
  }
  return null;
}
