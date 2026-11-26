import Constants from "expo-constants";
import { Platform } from "react-native";

import { resolveApiUrl } from "@/lib/resolveApiUrl";

export const apiUrl = resolveApiUrl({
  configuredUrl: process.env.EXPO_PUBLIC_API_URL,
  platformOS: Platform.OS,
  hostUri: Constants.expoConfig?.hostUri,
});
