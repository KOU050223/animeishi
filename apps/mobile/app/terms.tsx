import { TermsScreen } from "@/features/legal/screens/TermsScreen";
import { publicMetadata } from "@/lib/web/publicMetadata";

export function generateMetadata() {
  return publicMetadata(
    "/terms",
    "利用規約 - アニ名刺",
    "アニ名刺の利用規約。",
  );
}

export default function TermsRoute() {
  return <TermsScreen />;
}
