import { useLocalSearchParams } from "expo-router";
import {
  WorkListScreen,
  type WorkListScreenParams,
} from "@/features/work-lists/screens/WorkListScreen";

export default function WorkListRoute() {
  const params = useLocalSearchParams<WorkListScreenParams>();
  return <WorkListScreen params={params} />;
}
