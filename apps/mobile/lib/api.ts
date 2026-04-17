import { hc } from "hono/client";
import type { AppType } from "@animeishi/contracts";
import Constants from "expo-constants";

const apiUrl =
  (Constants.expoConfig?.extra?.apiUrl as string | undefined) ??
  process.env.EXPO_PUBLIC_API_URL ??
  "http://localhost:8787";

export const apiClient = hc<AppType>(apiUrl);
