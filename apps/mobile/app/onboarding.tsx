import { useLocalSearchParams } from "expo-router";
import {
  OnboardingScreen,
  type OnboardingScreenParams,
} from "@/features/onboarding/screens/OnboardingScreen";

export default function OnboardingRoute() {
  const params = useLocalSearchParams<OnboardingScreenParams>();
  return <OnboardingScreen params={params} />;
}
