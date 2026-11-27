import { useLocalSearchParams } from "expo-router";
import {
  SocialScreen,
  type SocialScreenParams,
} from "@/features/social/screens/SocialScreen";

export default function SocialRoute() {
  const params = useLocalSearchParams<SocialScreenParams>();
  return <SocialScreen params={params} />;
}
