import { ScrollView, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton } from "@/components/ui";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import {
  WorkDetailHeader,
  WorkDetailInfo,
} from "@/features/works/components/WorkDetailInfo";
import { WorkDetailSkeleton } from "@/features/works/components/WorkDetailSkeleton";
import {
  seasonListHref,
  workMediaLabel,
} from "@/features/works/components/workDetailFormat";
import { useWorkCatalogAccess } from "@/features/annict";
import { useWorkDetail } from "@/features/works/useWorkDetail";

function parseWorkId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 ? id : null;
}

// 作品ページ。作品詳細シート（AnimeWorkDetailSheet）の「作品ページを見る」
// から遷移し、シートでは折りたたむスタッフ・キャストを全件出す。
// 表示部分はシートと WorkDetailInfo を共有する。
export default function WorkScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id?: string }>();
  const workId = parseWorkId(params.id);
  const { canBrowseWorks, isLoading: isAccessLoading } = useWorkCatalogAccess();
  const detail = useWorkDetail(workId);
  const work = detail.data?.work;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  const screenOptions = (
    <Stack.Screen
      options={{
        title: work?.title ?? t("作品"),
        headerBackVisible: false,
        headerLeft: () => (
          <BackButton
            onPress={handleBack}
            accessibilityLabel={t("戻る")}
            testID="work-page-back"
          />
        ),
      }}
    />
  );

  if (workId === null) {
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["bottom"]}
      >
        {screenOptions}
        <View className="flex-1 items-center justify-center px-8">
          <Text className="text-center text-muted" testID="work-page-not-found">
            {t("この作品は表示できません")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isAccessLoading && !canBrowseWorks) {
    // 作品情報の取得は本人の Annict トークンか共用トークンが要る（issue #561）。
    return (
      <SafeAreaView
        className="flex-1 bg-white dark:bg-slate-900"
        edges={["bottom"]}
      >
        {screenOptions}
        <AnnictSoftGate
          description="作品情報の表示には Annict との連携が必要です。"
          surface="work_page"
          testID="work-page-soft-gate"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      {screenOptions}
      <ScrollView testID="work-page">
        <View className="w-full max-w-2xl self-center gap-5 px-6 pt-6 pb-10">
          {isAccessLoading || detail.isLoading ? (
            // 連携状態の確定前や詳細取得中は、実レイアウトと同じ形の
            // スケルトンを敷く（空の画面に遷移して見えないようにする）。
            <WorkDetailSkeleton />
          ) : (
            <>
              {work ? (
                <WorkDetailHeader
                  work={work}
                  mediaLabel={workMediaLabel(work.media, t)}
                  onOpenSeasonList={(seasonParam) =>
                    router.push(seasonListHref(seasonParam))
                  }
                />
              ) : null}
              <WorkDetailInfo detail={detail} creditsInitiallyExpanded />
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
