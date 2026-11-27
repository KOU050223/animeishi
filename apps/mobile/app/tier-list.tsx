import { useLocalSearchParams } from "expo-router";
import {
  TierListScreen,
  type TierListScreenParams,
} from "@/features/tier-lists/screens/TierListScreen";

export default function TierListRoute() {
  const params = useLocalSearchParams<TierListScreenParams>();
  return <TierListScreen params={params} />;
}
