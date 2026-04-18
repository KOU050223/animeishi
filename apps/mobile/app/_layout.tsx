import "../global.css";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@/lib/tokenCache";
import { Stack, useRouter, useSegments } from "expo-router";
import { useEffect } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient, asyncStoragePersister } from "@/lib/queryClient";

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error(
    "Clerk publishable key が設定されていません。.env に EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY を設定してください。"
  );
}

function AuthGuard() {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;

    const inAuthGroup = segments[0] === "(auth)";

    if (!isSignedIn && !inAuthGroup) {
      router.replace("/(auth)/sign-in");
    } else if (isSignedIn && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [isLoaded, isSignedIn, segments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <ClerkProvider tokenCache={tokenCache} publishableKey={publishableKey}>
      <PersistQueryClientProvider
        client={queryClient}
        persistOptions={{ persister: asyncStoragePersister }}
      >
        <AuthGuard />
      </PersistQueryClientProvider>
    </ClerkProvider>
  );
}
