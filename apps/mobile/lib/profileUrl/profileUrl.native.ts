import type { BuildProfileUrl } from "./types";

const configuredBaseUrl = process.env.EXPO_PUBLIC_WEB_URL;

export const buildProfileUrl: BuildProfileUrl = (userId) => {
  if (!userId) return null;
  if (configuredBaseUrl) {
    return `${configuredBaseUrl.replace(/\/+$/, "")}/user/${encodeURIComponent(userId)}`;
  }
  return `animeishi://user/${encodeURIComponent(userId)}`;
};
