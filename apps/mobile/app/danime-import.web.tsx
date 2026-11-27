import { useLocalSearchParams } from "expo-router";
import {
  DanimeImportWebScreen,
  type DanimeImportWebScreenParams,
} from "@/features/import/screens/DanimeImportWebScreen";

export default function DanimeImportWebRoute() {
  const params = useLocalSearchParams<DanimeImportWebScreenParams>();
  return <DanimeImportWebScreen params={params} />;
}
