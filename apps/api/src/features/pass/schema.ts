import { createRoute, z } from "@hono/zod-openapi";
import { bearerAuth, errorResponseSchema } from "@/lib/openapi";

const passFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  value: z.string(),
});

const meishiPassJsonSchema = z.object({
  formatVersion: z.number(),
  passTypeIdentifier: z.string(),
  teamIdentifier: z.string(),
  serialNumber: z.string(),
  organizationName: z.string(),
  description: z.string(),
  backgroundColor: z.string(),
  foregroundColor: z.string(),
  labelColor: z.string(),
  barcodes: z
    .array(
      z.object({
        format: z.literal("PKBarcodeFormatQR"),
        message: z.string(),
        messageEncoding: z.literal("iso-8859-1"),
      }),
    )
    .optional(),
  storeCard: z.object({
    primaryFields: z.array(passFieldSchema),
    secondaryFields: z.array(passFieldSchema),
    auxiliaryFields: z.array(passFieldSchema),
    backFields: z.array(passFieldSchema),
  }),
});

export const getMeishiPassJsonRoute = createRoute({
  method: "get",
  path: "/meishi.json",
  tags: ["pass"],
  summary: "Apple Wallet 用 pass.json の中身をプレビューする",
  description: "署名証明書が無くても叩ける（開発用）。",
  security: bearerAuth,
  responses: {
    200: {
      content: { "application/json": { schema: meishiPassJsonSchema } },
      description: "pass.json",
    },
    401: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "未認証",
    },
    404: {
      content: { "application/json": { schema: errorResponseSchema } },
      description: "プロフィールが無い",
    },
  },
});
