import { useLocalSearchParams } from "expo-router";
import {
  PublicProfileScreen,
  type PublicProfileScreenParams,
} from "@/features/users/screens/PublicProfileScreen";

export default function PublicProfileRoute() {
  const params = useLocalSearchParams<PublicProfileScreenParams>();
  return <PublicProfileScreen params={params} />;
}
