import { useAuth } from "@clerk/expo";
import { Redirect, Stack } from "expo-router";
import { useTranslation } from "react-i18next";
import LandingPage from "@/components/landing/LandingPage";
import { publicMetadata } from "@/lib/web/publicMetadata";

export function generateMetadata() {
  return publicMetadata(
    "/welcome",
    "アニ名刺 — 好きの記録が、あなたの名刺になる。",
    "アニメの視聴記録がそのまま名刺に。好きな作品や推しを共有して、アニメ好きとつながろう。",
  );
}

export default function WelcomeScreen() {
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
