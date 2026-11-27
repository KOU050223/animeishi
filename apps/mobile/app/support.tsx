import { SupportScreen } from "@/features/legal/screens/SupportScreen";
import { publicMetadata } from "@/lib/web/publicMetadata";

export function generateMetadata() {
  return publicMetadata(
    "/support",
    "サポート - アニ名刺",
    "アニ名刺のサポートページ。お問い合わせ先とヘルプ。",
  );
}

export default function SupportRoute() {
  return <SupportScreen />;
}
