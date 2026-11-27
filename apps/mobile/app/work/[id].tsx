import { useLocalSearchParams } from "expo-router";
import {
  WorkScreen,
  type WorkScreenParams,
} from "@/features/works/screens/WorkScreen";

export default function WorkRoute() {
  const params = useLocalSearchParams<WorkScreenParams>();
  return <WorkScreen params={params} />;
}
