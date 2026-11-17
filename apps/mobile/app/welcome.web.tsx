import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import LandingPage from "@/components/landing/LandingPage";

export default function WelcomeScreen() {
  const { isLoaded, isSignedIn } = useAuth();
  const { t } = useTranslation();

  if (!isLoaded)
    return <View className="flex-1 bg-slate-50 dark:bg-slate-950" />;
  if (isSignedIn) return <Redirect href="/" />;

  return (
    <>
      <Stack.Screen options={{ title: t("アニ名刺"), headerShown: false }} />
      <LandingPage />
    </>
  );
}
