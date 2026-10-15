import { z } from "zod";

// Annict OAuth: モバイルが deep link で受領した認可コードを交換するリクエスト。
// redirect_uri はトークン交換時の検証に使われるため、モバイルが実際に使った値を
// そのまま送る（Annict アプリ設定に登録済みの deep link）。
export const annictExchangeSchema = z
  .object({
    code: z.string().trim().min(1, "認可コードが必要です"),
    // URI 形式まで検証する。deep link（animeishi://annict）も Web（http://...）も
    // URL としてパースできるため z.url() で両方許容しつつ、typo は 400 で弾く。
    redirectUri: z
      .string()
      .trim()
      .min(1, "redirect_uri が必要です")
      .url("redirect_uri の形式が正しくありません"),
    // 交換モードは必須。default を持たせると、Web クライアントが mode を落としたときに
    // native 分岐へ fail-open し accessToken がボディで漏れるため、明示指定を強制する。
    //   "native": トークンをボディで返し、クライアント(SecureStore)が保持する。
    //   "web":    トークンを D1 に暗号化保存し、ボディにトークンを含めない（clerkUserId で参照）。
    mode: z.enum(["native", "web"]),
  })
  // http(s) の redirectUri（＝Web）は必ず mode:"web" でなければならない。
  // Web が誤って native を指定してトークンをボディで受け取る事故を防ぐ。
  .refine((v) => !(/^https?:\/\//.test(v.redirectUri) && v.mode !== "web"), {
    error: 'Web の redirect_uri では mode:"web" が必要です',
    path: ["mode"],
  });

export type AnnictExchangeInput = z.infer<typeof annictExchangeSchema>;
