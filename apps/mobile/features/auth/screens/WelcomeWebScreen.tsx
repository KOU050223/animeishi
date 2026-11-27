import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import LandingPage from "@/features/auth/components/LandingPage";

export function WelcomeWebScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const { t } = useTranslation();

  if (isLoaded && isSignedIn) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: t("アニ名刺"), headerShown: false }} />
      <LandingPage />
    </>
  );
}
