import type { Context } from "hono";
import { AnnictApiError } from "@/lib/annict/client";
import { AnnictSharedTokenRejectedError } from "@/lib/annict/workCatalog";

// Annict 通信エラーをクライアント向けレスポンスへ変換する。
// - 共用トークンの拒否（issue #561）は 503。利用者には本人の連携を促す
//   （利用者側で直せないため annict_token_invalid とは分ける）
// - 401（本人のトークン失効・スコープ不足）は再連携を促す
// - 429（Annict のレート制限）は 429。混雑として表示し、汎用障害と分ける
// - それ以外の Annict 由来障害は 502（上流障害）
// Annict 由来でなければ null を返し、呼び出し側で再 throw する。
export function annictErrorResponse(c: Context, err: unknown) {
  if (err instanceof AnnictSharedTokenRejectedError) {
    return c.json(
      {
        error: "作品情報を取得できません",
        code: "annict_shared_token_unavailable",
      },
      503,
    );
  }
  if (err instanceof AnnictApiError) {
    if (err.status === 401) {
      return c.json(
        { error: "Annict 連携が無効です", code: "annict_token_invalid" },
        401,
      );
    }
    if (err.status === 429) {
      return c.json(
        { error: "Annict が混み合っています", code: "annict_rate_limited" },
        429,
      );
    }
    return c.json(
      { error: "Annict との通信に失敗しました", code: "annict_upstream" },
      502,
    );
  }
  return null;
}
