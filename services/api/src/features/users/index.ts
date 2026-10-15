import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import { blockUserRoute, reportUserRoute, unblockUserRoute } from "./schema";
import { requireAuth } from "@/middleware/auth";
import type { AuthEnv, AuthVariables } from "@/middleware/auth";
import {
  usersRepository,
  ReportRateLimitError,
  UserNotFoundError,
} from "./repository";
import { createDb } from "@/db/client";
import { notifyUserReport } from "@/observability";
import { openapiValidationHook } from "@/lib/openapi";

function getBindings(
  c: Context,
): Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database } {
  return c.env as Omit<AuthEnv["Bindings"], "DB"> & { DB: D1Database };
}

// ユーザー通報・ブロック（App Store Guideline 1.2 の UGC 対策, issue #135）。
// ブロック一覧の取得は GET /me/blocks（features/me/index.ts）側にある。
const app = new OpenAPIHono<AuthVariables>({
  defaultHook: openapiValidationHook,
});
app.use("*", requireAuth);
const usersRoute = app
  .openapi(reportUserRoute, async (c) => {
    const { id: targetId } = c.req.valid("param");
    if (targetId === c.var.clerkUserId) {
      return c.json({ error: "自分自身を通報することはできません" }, 400);
    }
    const { reason } = c.req.valid("json");

    const db = createDb(getBindings(c).DB);
    const repo = usersRepository(db, c.var.clerkUserId);
    try {
      await repo.createReport(targetId, reason);
    } catch (e) {
      if (e instanceof UserNotFoundError) {
        return c.json({ error: "User not found" }, 404);
      }
      if (e instanceof ReportRateLimitError) {
        c.header("Retry-After", String(e.retryAfterSeconds));
        return c.json({ error: e.message, code: e.kind }, 429);
      }
      throw e;
    }

    // 運営がモデレーションできるよう Sentry Alert → Discord に通知する。
    notifyUserReport(c, {
      reporterId: c.var.clerkUserId,
      reportedUserId: targetId,
      reason,
    });
    return c.json({ success: true }, 201);
  })
  .openapi(blockUserRoute, async (c) => {
    const { id: targetId } = c.req.valid("param");
    if (targetId === c.var.clerkUserId) {
      return c.json({ error: "自分自身をブロックすることはできません" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const repo = usersRepository(db, c.var.clerkUserId);
    try {
      await repo.blockUser(targetId);
    } catch (e) {
      if (e instanceof UserNotFoundError) {
        return c.json({ error: "User not found" }, 404);
      }
      throw e;
    }
    return c.json({ success: true }, 200);
  })
  .openapi(unblockUserRoute, async (c) => {
    const { id: targetId } = c.req.valid("param");
    if (targetId === c.var.clerkUserId) {
      return c.json({ error: "自分自身のブロックは解除できません" }, 400);
    }

    const db = createDb(getBindings(c).DB);
    const repo = usersRepository(db, c.var.clerkUserId);
    await repo.unblockUser(targetId);
    return c.json({ success: true }, 200);
  });

export { usersRoute };
