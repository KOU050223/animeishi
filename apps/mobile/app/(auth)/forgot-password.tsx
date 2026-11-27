import { useLocalSearchParams } from "expo-router";
import {
  ForgotPasswordScreen,
  type ForgotPasswordScreenParams,
} from "@/features/auth/screens/ForgotPasswordScreen";

export default function ForgotPasswordRoute() {
  const params = useLocalSearchParams<ForgotPasswordScreenParams>();
  return <ForgotPasswordScreen params={params} />;
}
