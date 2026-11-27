import { PrivacyScreen } from "@/features/legal/screens/PrivacyScreen";
import { publicMetadata } from "@/lib/web/publicMetadata";

export function generateMetadata() {
  return publicMetadata(
    "/privacy",
    "プライバシーポリシー - アニ名刺",
    "アニ名刺のプライバシーポリシー。収集する情報とその利用目的について。",
  );
}

export default function PrivacyRoute() {
  return <PrivacyScreen />;
}
