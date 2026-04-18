import { hc } from "hono/client";
import type { AppType } from "@animeishi/contracts";

const apiUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8787";

export const apiClient = hc<AppType>(apiUrl);
