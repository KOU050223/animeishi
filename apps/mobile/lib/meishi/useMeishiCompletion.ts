import { useEffect, useState } from "react";
import { isMeishiComplete, missingMeishiCompletionSteps } from "./completion";
import type { MeishiCompletionStep } from "./completion";
import { loadMeishiDocument } from "./storage";
import type { MeishiDocument } from "./types";
import { useFavorites } from "@/lib/useFavorites";
import { useProfile } from "@/lib/useProfile";

export type MeishiCompletion = {
  /** 完成に足りない項目（空なら完成）。「残り N ステップ」の N に対応する。 */
  missing: MeishiCompletionStep[];
  isComplete: boolean;
  /** プロフィール・お気に入り・ドキュメントの読み込みが揃うまで true。 */
  isLoading: boolean;
  /** 判定に使った名刺ドキュメント（プレビュー表示にも使える）。 */
  document: MeishiDocument | null;
};

/**
 * 名刺の完成状態をプロフィール・お気に入り・保存済みドキュメントから
 * 組み立てる。完成の定義は lib/meishi/completion.ts（issue #419 と共通）。
 * オンボーディングの「名刺完成」画面と、ホームの完成度カード（#419）で共用する。
 */
export function useMeishiCompletion(): MeishiCompletion {
  const { data: profile, isLoading: profileLoading } = useProfile();
  const { data: favorites, isLoading: favoritesLoading } = useFavorites();
  const [document, setDocument] = useState<MeishiDocument | null>(null);
  const [docLoaded, setDocLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadMeishiDocument().then((doc) => {
      if (cancelled) return;
      setDocument(doc);
      setDocLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const input = {
    profileImageUrl: profile?.profileImageUrl,
    username: profile?.username,
    favoritesCount: favorites?.length ?? 0,
    document,
  };
  const missing = missingMeishiCompletionSteps(input);

  return {
    missing,
    isComplete: isMeishiComplete(input),
    isLoading: profileLoading || favoritesLoading || !docLoaded,
    document,
  };
}
