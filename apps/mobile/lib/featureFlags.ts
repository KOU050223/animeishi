export const featureFlags = {
  debugPanel: process.env.EXPO_PUBLIC_FEATURE_DEBUG_PANEL === "true",
} as const;
