import { useLocalSearchParams } from "expo-router";
import {
  MeishiViewerScreen,
  type MeishiViewerScreenParams,
} from "@/features/meishi/screens/MeishiViewerScreen";

export default function MeishiViewerRoute() {
  const params = useLocalSearchParams<MeishiViewerScreenParams>();
  return <MeishiViewerScreen params={params} />;
}
