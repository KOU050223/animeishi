import { z } from "zod";

export const shareTokenParamSchema = z.object({
  token: z.string().min(1).max(128),
});
