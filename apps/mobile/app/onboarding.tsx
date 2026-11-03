import { useCallback, useEffect, useState } from "react";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@clerk/expo";
import { useTranslation } from "react-i18next";
import {
  buildOnboardingDocument,
  loadOnboardingStatus,
  onboardingPending,
  saveOnboardingStatus,
  type OnboardingStatus,
} from "@/lib/onboarding";
import { getTemplate } from "@/lib/meishi/templates";
import { saveMeishiDocument } from "@/lib/meishi/storage";
import type { MeishiDocument } from "@/lib/meishi/types";
import { useAddFavorite } from "@/lib/useFavorites";
import type { WorkCandidate } from "@/lib/useWorkCandidates";
import { ApiRequestError } from "@/lib/apiError";
import {
  FavoriteWorksStep,
  ONBOARDING_FAVORITE_COUNT,
} from "@/components/onboarding/FavoriteWorksStep";
import { TemplateStep } from "@/components/onboarding/TemplateStep";
import { CompletionStep } from "@/components/onboarding/CompletionStep";
import { AnnictStep } from "@/components/onboarding/AnnictStep";
import { NotificationStep } from "@/components/onboarding/NotificationStep";

// 「好きな作品 → テンプレート → 名刺完成 → Annict → 通知」の順。
// 1 画面 1 問・進捗バー付き（issue #412 決定）。
const TOTAL_STEPS = 5;

/**
 * 初回オンボーディング（issue #412）。
 * サインアップ直後だけに出す。エントリは 2 経路:
 * - native / メール登録: sign-up 画面が onboardingPending を立てて遷移
 * - Web の Google 新規登録: sso-callback が /onboarding?fresh=1 へ
 *   フルリロードさせる（モジュール状態が戻るため pending ではなく URL で判定）
 * どちらでもなければホームへ戻す（既存ユーザー・直 URL 打ちは対象外）。
 * 完了/スキップはユーザー単位で AsyncStorage に記録し、二度と出さない。
 */
export default function OnboardingScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { userId } = useAuth();
  const { fresh } = useLocalSearchParams<{ fresh?: string }>();

  // 初回レンダー時点のエントリ判定。pending フラグはマウント後に下ろすため
  // 後から再評価されないよう state の初期値に閉じ込める。
  const [allowed] = useState(() => onboardingPending.current || fresh === "1");
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedWorks, setSelectedWorks] = useState<WorkCandidate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [document, setDocument] = useState<MeishiDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const addFavorite = useAddFavorite();

  // AuthGuard の追い出し抑止は (auth) を離れた時点で不要になる。
  useEffect(() => {
    onboardingPending.current = false;
  }, []);

  // 完了/スキップ済みのユーザー（直 URL 打ち等）には出し直さない。
  useEffect(() => {
    if (!allowed || !userId) return;
    void loadOnboardingStatus(userId).then((record) => {
      if (record) router.replace("/");
    });
  }, [allowed, userId, router]);

  const finish = useCallback(
    async (status: OnboardingStatus) => {
      if (userId) await saveOnboardingStatus(userId, status);
      router.replace("/");
    },
    [userId, router],
  );

  const handleSkip = useCallback(() => {
    void finish("skipped");
  }, [finish]);

  const handleToggleWork = useCallback((work: WorkCandidate) => {
    setSelectedWorks((prev) =>
      prev.some((w) => w.annictWorkId === work.annictWorkId)
        ? prev.filter((w) => w.annictWorkId !== work.annictWorkId)
        : prev.length < ONBOARDING_FAVORITE_COUNT
          ? [...prev, work]
          : prev,
    );
  }, []);

  // 1 問目 → 2 問目: 選んだ 3 作を既存のお気に入りとして保存する。
  // 候補は annict_works キャッシュ由来なので Annict トークン無しで登録できる。
  // addFavorite は重複時 no-op（API 側 onConflictDoNothing）なので
  // やり直しでも冪等。
  const handleFavoritesNext = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await Promise.all(
        selectedWorks.map((w) => addFavorite.mutateAsync(w.annictWorkId)),
      );
      setStepIndex(1);
    } catch (err) {
      setSaveError(
        err instanceof ApiRequestError
          ? t("推し作品の登録に失敗しました。もう一度お試しください。")
          : t("予期しないエラーが発生しました"),
      );
    } finally {
      setSaving(false);
    }
  }, [saving, selectedWorks, addFavorite, t]);

  // 2 問目 → 3 問目: テンプレート + 推しコラージュのドキュメントを保存する。
  const handleTemplateNext = useCallback(() => {
    const template = templateId ? getTemplate(templateId) : undefined;
    if (!template) return;
    const doc = buildOnboardingDocument(template);
    void saveMeishiDocument(doc);
    setDocument(doc);
    setStepIndex(2);
  }, [templateId]);

  if (!allowed) {
    return <Redirect href="/" />;
  }

  switch (stepIndex) {
    case 0:
      return (
        <FavoriteWorksStep
          stepIndex={0}
          totalSteps={TOTAL_STEPS}
          selected={selectedWorks}
          onToggle={handleToggleWork}
          onNext={() => {
            void handleFavoritesNext();
          }}
          saving={saving}
          error={saveError}
          onSkip={handleSkip}
        />
      );
    case 1:
      return (
        <TemplateStep
          stepIndex={1}
          totalSteps={TOTAL_STEPS}
          selectedTemplateId={templateId}
          onSelect={setTemplateId}
          onNext={handleTemplateNext}
          onSkip={handleSkip}
        />
      );
    case 2:
      return document ? (
        <CompletionStep
          stepIndex={2}
          totalSteps={TOTAL_STEPS}
          document={document}
          onNext={() => setStepIndex(3)}
          onSkip={handleSkip}
        />
      ) : null;
    case 3:
      return (
        <AnnictStep
          stepIndex={3}
          totalSteps={TOTAL_STEPS}
          onNext={() => setStepIndex(4)}
          onSkip={handleSkip}
        />
      );
    default:
      return (
        <NotificationStep
          stepIndex={4}
          totalSteps={TOTAL_STEPS}
          onDone={() => {
            void finish("completed");
          }}
          onSkip={handleSkip}
        />
      );
  }
}
