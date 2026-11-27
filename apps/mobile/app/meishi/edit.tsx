import { useLocalSearchParams } from "expo-router";
import {
  MeishiEditScreen,
  type MeishiEditScreenParams,
} from "@/features/meishi/screens/MeishiEditScreen";

export default function MeishiEditRoute() {
  const params = useLocalSearchParams<MeishiEditScreenParams>();
  return <MeishiEditScreen params={params} />;
}
