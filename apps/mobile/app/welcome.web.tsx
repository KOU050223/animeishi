import { WelcomeWebScreen } from "@/features/auth/screens/WelcomeWebScreen";
import { publicMetadata } from "@/lib/web/publicMetadata";

export function generateMetadata() {
  return publicMetadata(
    "/welcome",
    "アニ名刺 — 好きの記録が、あなたの名刺になる。",
    "アニメの視聴記録がそのまま名刺に。好きな作品や推しを共有して、アニメ好きとつながろう。",
  );
}

export default function WelcomeWebRoute() {
  return <WelcomeWebScreen />;
}
