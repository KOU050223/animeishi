import Constants from "expo-constants";
import { Platform } from "react-native";

const DEFAULT_API_URL = "http://localhost:8787";
const API_PORT = "8787";

type ResolveApiUrlInput = {
  configuredUrl?: string;
  platformOS: typeof Platform.OS;
  hostUri?: string | null;
};

function extractHost(hostUri?: string | null): string | null {
  if (!hostUri) return null;
  const withoutProtocol = hostUri.replace(/^[a-z]+:\/\//i, "");
  const host = withoutProtocol.split("/")[0]?.split(":")[0];
  return host && host !== "localhost" && host !== "127.0.0.1" ? host : null;
}

function isLoopbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function resolveApiUrl({
  configuredUrl,
  platformOS,
  hostUri,
}: ResolveApiUrlInput): string {
  const fallbackUrl = configuredUrl || DEFAULT_API_URL;
  if (platformOS === "web" || !isLoopbackUrl(fallbackUrl)) return fallbackUrl;

  const host = extractHost(hostUri);
  if (!host) return fallbackUrl;

  return `http://${host}:${API_PORT}`;
}

export const apiUrl = resolveApiUrl({
  configuredUrl: process.env.EXPO_PUBLIC_API_URL,
  platformOS: Platform.OS,
  hostUri: Constants.expoConfig?.hostUri,
});
