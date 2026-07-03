import { hc } from "hono/client";
import type { AppType } from "@animeishi/api";
import { apiUrl } from "@/lib/apiUrl";

export const apiClient = hc<AppType>(apiUrl);
