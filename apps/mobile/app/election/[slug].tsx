import { useLocalSearchParams } from "expo-router";
import {
  ElectionScreen,
  type ElectionScreenParams,
} from "@/features/elections/screens/ElectionScreen";

export default function ElectionRoute() {
  const params = useLocalSearchParams<ElectionScreenParams>();
  return <ElectionScreen params={params} />;
}
