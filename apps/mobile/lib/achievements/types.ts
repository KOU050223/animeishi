import type { InferResponseType } from "hono/client";
import { apiClient } from "@/lib/api";

export type AchievementsResponse = InferResponseType<
  (typeof apiClient.me)["achievements"]["$get"],
  200
>;

export type Achievement = AchievementsResponse["achievements"][number];
export type AchievementKind = Achievement["kind"];
