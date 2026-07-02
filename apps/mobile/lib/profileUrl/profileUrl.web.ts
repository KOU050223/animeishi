import type { BuildProfileUrl } from "./types";

const configuredBaseUrl = process.env.EXPO_PUBLIC_WEB_URL;
const productionBaseUrl = "https://animeishi.uomi.dev";

function resolveBaseUrl(): string {
  if (configuredBaseUrl) return configuredBaseUrl;
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }
  return productionBaseUrl;
}

export const buildProfileUrl: BuildProfileUrl = (userId) => {
  if (!userId) return null;
  const baseUrl = resolveBaseUrl().replace(/\/+$/, "");
  return `${baseUrl}/user/${encodeURIComponent(userId)}`;
};
