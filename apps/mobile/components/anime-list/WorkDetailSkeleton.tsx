import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";

// 詳細行（話数・視聴者数・満足度・レビュー数）の骨の並び。実側の
// DetailRow（左ラベル・右値）と同じ justify-between 配置にする。
const DETAIL_ROW_WIDTHS = ["w-20", "w-14", "w-16"] as const;

// スタッフ・キャストのチップ群の骨。実側は可変幅の pill が折り返すため、
// 幅をばらけさせておく。
const CREDIT_CHIP_WIDTHS = ["w-24", "w-32", "w-20", "w-28", "w-16", "w-24"];

/**
 * 作品ページ（/work/[id]）の読み込み中スケルトン。WorkDetailHeader と
 * WorkDetailInfo の並びを 1 つの領域として敷き、読み上げは
 * 「作品を読み込んでいます」の 1 回にまとめる。
 */
export function WorkDetailSkeleton() {
  const { t } = useTranslation();
  return (
    <SkeletonGroup
      accessibilityLabel={t("作品を読み込んでいます")}
      className="gap-5"
      testID="work-detail-skeleton"
    >
      {/* WorkDetailHeader と同じ ポスター + タイトル列 の並び */}
      <View className="flex-row gap-4">
        <Skeleton className="h-[92px] w-[68px] rounded-md" />
        <View className="flex-1 justify-center gap-2 pr-6">
          <Skeleton className="h-5 w-4/5 rounded" />
          <Skeleton className="h-3.5 w-1/2 rounded" muted />
          <View className="mt-2 flex-row gap-1.5">
            <Skeleton className="h-6 w-20 rounded-full" muted />
            <Skeleton className="h-6 w-14 rounded-full" muted />
          </View>
        </View>
      </View>
      <WorkDetailInfoSkeletonBody />
    </SkeletonGroup>
  );
}

/**
 * 詳細シート内で WorkDetailInfo が読み込む間の行スケルトン。
 * シートにはカード由来のヘッダーが既に出ているため、詳細情報部分だけを
 * 敷く（WorkDetailSkeleton と骨の並びを共有する）。
 */
export function WorkDetailInfoSkeleton() {
  const { t } = useTranslation();
  return (
    <SkeletonGroup
      accessibilityLabel={t("読み込み中")}
      className="gap-3"
      testID="work-detail-info-skeleton"
    >
      <WorkDetailInfoSkeletonBody />
    </SkeletonGroup>
  );
}

/** 詳細行・チップ群・リンク行の骨。WorkDetailSection の並びに合わせる。 */
function WorkDetailInfoSkeletonBody() {
  return (
    <View className="gap-3">
      <View className="gap-2">
        {DETAIL_ROW_WIDTHS.map((valueWidth, i) => (
          <View key={i} className="flex-row justify-between gap-4">
            <Skeleton className="h-3.5 w-16 rounded" />
            <Skeleton className={`h-3.5 rounded ${valueWidth}`} muted />
          </View>
        ))}
      </View>
      <View className="gap-2">
        <Skeleton className="h-4 w-32 rounded" muted />
        <View className="flex-row flex-wrap gap-1.5">
          {CREDIT_CHIP_WIDTHS.map((width, i) => (
            <Skeleton key={i} className={`h-6 rounded-full ${width}`} muted />
          ))}
        </View>
      </View>
      <View className="flex-row gap-4">
        <Skeleton className="h-4 w-20 rounded" muted />
        <Skeleton className="h-4 w-24 rounded" muted />
      </View>
    </View>
  );
}
