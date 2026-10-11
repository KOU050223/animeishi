import "../global.css";
import "@/lib/i18n";
import * as Sentry from "@sentry/react-native";
import { initObservability } from "@/lib/observability";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { ClerkProvider, useAuth } from "@clerk/clerk-expo";
import { tokenCache } from "@/lib/tokenCache";
import {
  Stack,
  useRouter,
  useSegments,
  type ErrorBoundaryProps,
} from "expo-router";
import { useEffect } from "react";
import { RootErrorBoundary } from "@/components/RootErrorBoundary";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { queryClient, asyncStoragePersister } from "@/lib/queryClient";

// グローバルエラーハンドラを先に有効化するため、レンダリング前に初期化する。
// SENTRY_DSN 未設定の環境では no-op になる（lib/observability.ts 参照）。
initObservability();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error(
    "Clerk publishable key が設定されていません。.env に EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY を設定してください。",
  );
}

function AuthGuard() {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!isLoaded) return;

    const inAuthGroup = segments[0] === "(auth)";
    // user: 公開プロフィール。annict: OAuth コールバック着地（サインインへ飛ばすと
    // Clerk ロード待ちの間に URL の code/state を失うため、ガードの対象外にする）。
    // privacy / terms: ストア審査・未ログイン参照用の公開法務ページ。
    // support: ストア掲載のサポート URL。未ログインでも閲覧できる必要がある。
    const inPublicGroup =
      segments[0] === "user" ||
      segments[0] === "annict" ||
      segments[0] === "privacy" ||
      segments[0] === "terms" ||
      segments[0] === "support";

    if (!isSignedIn && !inAuthGroup && !inPublicGroup) {
      router.replace("/(auth)/sign-in");
    } else if (isSignedIn && inAuthGroup) {
      router.replace("/(tabs)");
    }
  }, [isLoaded, isSignedIn, segments]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="user/[uid]" />
      {/* Annict OAuth の Web コールバック着地ルート（/annict）。 */}
      <Stack.Screen name="annict" />
      {/* 公開法務ページ（/privacy /terms）。ストア審査で未ログイン閲覧が必要。 */}
      <Stack.Screen name="privacy" />
      <Stack.Screen name="terms" />
      {/* 公開サポートページ（/support）。ストア掲載のサポート URL。 */}
      <Stack.Screen name="support" />
      {/* 名刺エディタ */}
      <Stack.Screen name="meishi/edit" />
      {/* シーズンごとのアニメ tier 表 */}
      <Stack.Screen name="tier-list" />
      {/* dアニメストアからの視聴履歴インポート（native: WebView / web: ブックマークレット） */}
      <Stack.Screen name="danime-import" />
      <Stack.Screen name="danime-import-review" />
    </Stack>
  );
}

// expo-router のルート ErrorBoundary。子ルートのレンダリング中に投げられた
// 例外を捕捉し、再試行ボタン付きの画面にフォールバックする
// （Sentry 送信は RootErrorBoundary 側）。
export function ErrorBoundary(props: ErrorBoundaryProps) {
  return <RootErrorBoundary {...props} />;
}

// Sentry.wrap で ErrorBoundary を付与し、レンダリング中の例外も捕捉する。
export default Sentry.wrap(function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ClerkProvider tokenCache={tokenCache} publishableKey={publishableKey}>
        <PersistQueryClientProvider
          client={queryClient}
          persistOptions={{ persister: asyncStoragePersister }}
        >
          <AuthGuard />
        </PersistQueryClientProvider>
      </ClerkProvider>
    </GestureHandlerRootView>
  );
});
