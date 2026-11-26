import { createRoute, z } from "@hono/zod-openapi";
import { errorResponseSchema, rateLimitedErrorResponse } from "@/lib/openapi";

const demoSignInSchema = z.object({
  email: z.email("Invalid email format").max(320),
  password: z.string().min(1, "Password is required").max(256),
});

const demoSignInResponseSchema = z.object({
  ticket: z.string(),
});

const jsonError = (description: string) => ({
  content: { "application/json": { schema: errorResponseSchema } },
  description,
});

export const demoSignInRoute = createRoute({
  method: "post",
  path: "/demo-sign-in",
  tags: ["auth"],
  summary:
    "デモアカウント（App Store 審査・Expo Explore 用）の sign-in token を発行する",
  description:
    "Clerk の Device Trust は新しい端末からのパスワードサインインにメールコードを求めるため、" +
    "メールを受け取れない審査員と自動キャプチャはログインできない。" +
    "デモアカウントに限りパスワードを照合して sign-in token（ticket）を返し、" +
    "アプリは ticket でサインインする。デモアカウント以外は常に 401。",
  request: {
    body: {
      content: { "application/json": { schema: demoSignInSchema } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: demoSignInResponseSchema } },
      description: "sign-in token を発行した",
    },
    400: jsonError("入力エラー"),
    401: jsonError("デモアカウントではない、またはパスワードが違う"),
    429: rateLimitedErrorResponse("試行回数の上限"),
  },
});
