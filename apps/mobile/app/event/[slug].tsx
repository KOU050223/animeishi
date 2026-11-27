import { useLocalSearchParams } from "expo-router";
import {
  EventScreen,
  type EventScreenParams,
} from "@/features/events/screens/EventScreen";

export default function EventRoute() {
  const params = useLocalSearchParams<EventScreenParams>();
  return <EventScreen params={params} />;
}
