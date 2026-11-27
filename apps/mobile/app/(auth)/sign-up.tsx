import { useLocalSearchParams } from "expo-router";
import {
  SignUpScreen,
  type SignUpScreenParams,
} from "@/features/auth/screens/SignUpScreen";

export default function SignUpRoute() {
  const params = useLocalSearchParams<SignUpScreenParams>();
  return <SignUpScreen params={params} />;
}
