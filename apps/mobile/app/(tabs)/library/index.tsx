import { useLocalSearchParams } from "expo-router";
import {
  LibraryScreen,
  type LibraryScreenParams,
} from "@/features/library/screens/LibraryScreen";

export default function LibraryRoute() {
  const params = useLocalSearchParams<LibraryScreenParams>();
  return <LibraryScreen params={params} />;
}
