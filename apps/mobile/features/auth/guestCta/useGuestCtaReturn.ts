import { useEffect, useLayoutEffect, useRef } from "react";
import { useAuth } from "@clerk/expo";
import { useRouter, useSegments } from "expo-router";
import type { Href } from "expo-router";
import { trackEvent } from "@/lib/events";
import { consumePendingReturn } from "./storage";

// 登録・サインインの途中にいる画面。ここを抜けてから戻す。
// onboarding / passkey-prompt はサインアップ直後に挟まる画面で、
// 終わるとホームへ遷移するため、その後に元のプロフィールを開く。
// annict はオンボーディングの Annict 連携の戻り先。連携処理の完了後に
// 作品一覧へ置き換わるため、ここで開くとその遷移に上書きされる。
const IN_PROGRESS_SEGMENTS = new Set([
  "(auth)",
  "onboarding",
  "passkey-prompt",
  "annict",
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
  // 同じ先頭セグメント内の遷移（タブ間など）でも、読み出しに失敗した記録を
  // 再試行できるよう、ルート全体の変化で effect を走らせる。
  const route = segments.join("/");
  // ストレージ読み出し中にサインアウトした場合、完了時に遷移させない。
  // 読み出しの完了がサインアウトのコミット直後に来ても古い値を見ないよう、
  // 通常の effect より先に走る layout effect で同期する。
  const signedInRef = useRef(isSignedIn);
  useLayoutEffect(() => {
    signedInRef.current = isSignedIn;
  }, [isSignedIn]);

  useEffect(() => {
    const top = route.split("/")[0] ?? "";
    if (!isLoaded || !isSignedIn || IN_PROGRESS_SEGMENTS.has(top)) return;
    void consumePendingReturn().then((path) => {
      if (!path || !signedInRef.current) return;
      trackEvent("guest_cta_return", { source: "profile" });
      // push にして、プロフィールから戻るとホームに着くようにする。
      // isReturnablePath で /user/{id} だけに絞ってあるので内部ルート。
      const href: unknown = path;
      router.push(href as Href);
    });
  }, [isLoaded, isSignedIn, route, router]);
}
