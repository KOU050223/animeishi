import { Redirect } from "expo-router";

export default function NativeWelcomeFallback() {
  return <Redirect href="/" />;
}
