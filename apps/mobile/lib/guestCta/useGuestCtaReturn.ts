import { useEffect } from "react";
import { useAuth } from "@clerk/expo";
import { useRouter, useSegments } from "expo-router";
import type { Href } from "expo-router";
import { trackEvent } from "@/lib/events";
import { consumePendingReturn } from "./storage";

// 登録・サインインの途中にいる画面。ここを抜けてから戻す。
// onboarding / passkey-prompt はサインアップ直後に挟まる画面で、
// 終わるとホームへ遷移するため、その後に元のプロフィールを開く。
const IN_PROGRESS_SEGMENTS = new Set([
  "(auth)",
  "onboarding",
  "passkey-prompt",
]);

/**
 * 未ログインで公開プロフィールの CTA を押した人を、サインイン後に
 * 元のプロフィールへ戻す（issue #562）。ルートレイアウトで 1 度だけ呼ぶ。
 * 登録・サインインの各画面は終了時にホームへ遷移するので、個別に
 * 戻り先を受け渡さずここで一括して拾う（Web の Google 登録のように
 * ページ全体のリダイレクトを挟む経路も同じく拾える）。
 */
export function useGuestCtaReturn(): void {
  const { isLoaded, isSignedIn } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const top = segments[0] ?? "";

  useEffect(() => {
    if (!isLoaded || !isSignedIn || IN_PROGRESS_SEGMENTS.has(top)) return;
    void consumePendingReturn().then((path) => {
      if (!path) return;
      trackEvent("guest_cta_return", { source: "profile" });
      // push にして、プロフィールから戻るとホームに着くようにする。
      // isReturnablePath で /user/{id} だけに絞ってあるので内部ルート。
      const href: unknown = path;
      router.push(href as Href);
    });
  }, [isLoaded, isSignedIn, top, router]);
}
