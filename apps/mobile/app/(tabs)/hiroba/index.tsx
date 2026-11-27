import { useLocalSearchParams } from "expo-router";
import {
  HirobaScreen,
  type HirobaScreenParams,
} from "@/features/hiroba/screens/HirobaScreen";

export default function HirobaRoute() {
  const params = useLocalSearchParams<HirobaScreenParams>();
  return <HirobaScreen params={params} />;
}
