import { useLocalSearchParams } from "expo-router";
import {
  PublicWorkListScreen,
  type PublicWorkListScreenParams,
} from "@/features/work-lists/screens/PublicWorkListScreen";

export default function PublicWorkListRoute() {
  const params = useLocalSearchParams<PublicWorkListScreenParams>();
  return <PublicWorkListScreen params={params} />;
}
