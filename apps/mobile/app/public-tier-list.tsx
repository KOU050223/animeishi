import { useLocalSearchParams } from "expo-router";
import {
  PublicTierListScreen,
  type PublicTierListScreenParams,
} from "@/features/tier-lists/screens/PublicTierListScreen";

export default function PublicTierListRoute() {
  const params = useLocalSearchParams<PublicTierListScreenParams>();
  return <PublicTierListScreen params={params} />;
}
