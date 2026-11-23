import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";
import { useThemeColors } from "@/lib/theme";
import type { useWorkDetail, WorkDetail } from "@/lib/useWorkDetail";
import { annictWorkUrl } from "./workDetailFormat";
import type { WorkDetailSheetTarget } from "./workDetailFormat";
import { AnimePoster } from "./AnimePoster";
import {
  formatSeasonLabel,
  SEASON_FILTER_ALL,
  toSeasonParam,
  workBroadcastSeason,
} from "./animeListUtils";

// 作品詳細シート（AnimeWorkDetailSheet）と作品ページ（app/work/[id]）で
// 共有する、作品情報の表示部分。

/** ポスター・タイトル（日英）・シーズン・メディア種別のヘッダー部。 */
export function WorkDetailHeader({
  work,
  mediaLabel,
  onOpenSeasonList,
}: {
  work: WorkDetailSheetTarget;
  mediaLabel: string | null;
  onOpenSeasonList: (seasonParam: string) => void;
}) {
  const { t } = useTranslation();
  // 放送シーズンのチップ（issue #535）。押すとそのシーズン / 年通年の
  // 作品一覧へ移る。seasonYear / seasonName が無い作品（または Annict が
  // 返さない形式）はチップを出さない。年だけ取れた作品は年チップのみ出す。
  const season = workBroadcastSeason(work);
  return (
    <View className="flex-row gap-4">
      <AnimePoster uri={work.hostedImageUrl} title={work.title} />
      {/* pr-6 は Web シート右上の閉じるボタンと長いタイトルの重なりを避ける余白 */}
      <View className="flex-1 min-w-0 justify-center pr-6">
        <Text
          className="text-lg font-bold text-slate-900 dark:text-slate-100"
          numberOfLines={3}
        >
          {work.title}
        </Text>
        {work.titleEn ? (
          <Text
            className="mt-1 text-xs text-slate-500 dark:text-slate-400"
            numberOfLines={2}
          >
            {work.titleEn}
          </Text>
        ) : null}
        {work.seasonYear || mediaLabel ? (
          <View className="mt-2 flex-row flex-wrap items-center gap-1.5">
            {season ? (
              <SeasonLinkChip
                label={formatSeasonLabel(season.year, season.key, t)}
                onPress={() =>
                  onOpenSeasonList(toSeasonParam(season.year, season.key))
                }
                testID="work-detail-season-chip"
              />
            ) : null}
            {work.seasonYear ? (
              <SeasonLinkChip
                label={formatSeasonLabel(work.seasonYear, SEASON_FILTER_ALL, t)}
                onPress={() => onOpenSeasonList(`${work.seasonYear}`)}
                testID="work-detail-year-chip"
              />
            ) : null}
            {mediaLabel ? (
              <Text className="text-xs text-slate-500 dark:text-slate-400">
                {mediaLabel}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** 放送シーズンから同時期の作品一覧へ移るチップ（issue #535）。 */
function SeasonLinkChip({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={8}
      className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 dark:border-indigo-800 dark:bg-indigo-950"
      accessibilityRole="button"
      accessibilityLabel={t("{{label}}の作品一覧を見る", { label })}
      testID={testID}
    >
      <Text className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
        {label}
      </Text>
    </TouchableOpacity>
  );
}

/** セクションの見出し（視聴ステータス・評価・話数で共有）。 */
export function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">
      {children}
    </Text>
  );
}

/** Annict の詳細情報。読み込み中・失敗はカードの情報だけ表示する。 */
export function WorkDetailInfo({
  detail,
  creditsInitiallyExpanded = false,
}: {
  detail: ReturnType<typeof useWorkDetail>;
  /** 作品ページではスタッフ・キャストを最初から全件出す。 */
  creditsInitiallyExpanded?: boolean;
}) {
  const { t } = useTranslation();
  const colors = useThemeColors();

  if (detail.isLoading) {
    return (
      <View className="items-center py-4">
        <ActivityIndicator size="small" color={colors.textMuted} />
      </View>
    );
  }
  if (detail.isError) {
    return (
      <View className="items-center py-2 gap-2">
        <Text className="text-xs text-slate-400 dark:text-slate-500">
          {t("詳細情報を取得できませんでした")}
        </Text>
        <TouchableOpacity
          onPress={() => detail.refetch()}
          accessibilityRole="button"
          accessibilityLabel={t("詳細情報を再取得")}
          testID="work-detail-retry"
        >
          <Text className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            {t("再試行")}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }
  if (!detail.data?.work) return null;
  return (
    <WorkDetailSection
      work={detail.data.work}
      creditsInitiallyExpanded={creditsInitiallyExpanded}
    />
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="text-xs text-slate-400 dark:text-slate-500">
        {label}
      </Text>
      <Text className="text-xs font-semibold text-slate-700 dark:text-slate-200">
        {value}
      </Text>
    </View>
  );
}

export function DetailLink({
  label,
  url,
  color,
}: {
  label: string;
  url: string;
  color: string;
}) {
  return (
    <TouchableOpacity
      className="flex-row items-center gap-1.5 py-1"
      onPress={() => void Linking.openURL(url)}
      accessibilityRole="link"
      accessibilityLabel={label}
    >
      <Ionicons name="open-outline" size={13} color={color} />
      <Text className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// Annict GraphQL の役職は enum ではなく日本語ラベル（staff.roleText か
// 自由記述の roleOther）で返るため、常時表示する「主要な役職」
// （issue #536）をラベルの一致で判定する。総監督は監督の上位役職なので
// 主要側に含める。
const MAJOR_STAFF_ROLES = new Set([
  "原作",
  "監督",
  "総監督",
  "シリーズ構成",
  "キャラクターデザイン",
  "音楽",
  "アニメーション制作",
]);

// 常時表示するスタッフの判定。issue #536 は「制作会社」を主要役職とは
// 別立てで列挙しているため、団体は役職ラベル（「制作協力」「企画」等）
// に関わらず常時表示する。
function isVisibleStaff(staff: WorkDetail["staffs"][number]): boolean {
  return (
    staff.resource.kind === "organization" || MAJOR_STAFF_ROLES.has(staff.role)
  );
}

// 初期表示するキャスト数。Annict の casts は SORT_NUMBER 順（主要キャラが
// 先頭）で返る。これ以降のキャストと主要役職以外のスタッフは
// 「もっと見る」で展開する。
const INITIAL_CAST_COUNT = 10;

/**
 * 制作会社・スタッフ・キャストのチップ一覧（issue #536 第 1 段階）。
 * チップを押すと Annict の人物・団体ページを外部ブラウザで開く
 * （アプリ内の逆引き一覧は第 2 段階・別 Issue）。スタッフは役職付き、
 * キャストは演じたキャラクター名付きで出す。スタッフ・キャストとも
 * 無い作品ではセクション自体を出さない。
 */
function CreditsSection({
  staffs,
  casts,
  initiallyExpanded,
}: {
  staffs: WorkDetail["staffs"];
  casts: WorkDetail["casts"];
  initiallyExpanded: boolean;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const visibleStaffs = expanded ? staffs : staffs.filter(isVisibleStaff);
  const visibleCasts = expanded ? casts : casts.slice(0, INITIAL_CAST_COUNT);
  const hiddenCount =
    staffs.length - visibleStaffs.length + casts.length - visibleCasts.length;

  if (staffs.length === 0 && casts.length === 0) return null;

  return (
    <View className="gap-3">
      {visibleStaffs.length > 0 ? (
        <View>
          <SectionTitle>{t("スタッフ・制作会社")}</SectionTitle>
          <View className="flex-row flex-wrap gap-1.5">
            {visibleStaffs.map((staff) => (
              <CreditChip
                key={staff.annictStaffId}
                label={staff.role ? `${staff.role}：${staff.name}` : staff.name}
                url={
                  staff.resource.kind === "organization"
                    ? `https://annict.com/organizations/${staff.resource.annictId}`
                    : `https://annict.com/people/${staff.resource.annictId}`
                }
                accessibilityLabel={t(
                  "{{name}}（{{role}}）の Annict ページを開く",
                  {
                    name: staff.name,
                    role: staff.role,
                  },
                )}
                testID={`work-detail-staff-${staff.annictStaffId}`}
              />
            ))}
          </View>
        </View>
      ) : null}
      {visibleCasts.length > 0 ? (
        <View>
          <SectionTitle>{t("キャスト")}</SectionTitle>
          <View className="flex-row flex-wrap gap-1.5">
            {visibleCasts.map((cast) => {
              // 読み上げでも兼役の担当キャラを区別できるよう、表示と
              // 同じ条件でキャラクター名をラベルに含める。
              const castName = cast.characterName
                ? `${cast.personName}（${cast.characterName}）`
                : cast.personName;
              return (
                <CreditChip
                  key={cast.annictCastId}
                  label={castName}
                  url={`https://annict.com/people/${cast.annictPersonId}`}
                  accessibilityLabel={t("{{name}}の Annict ページを開く", {
                    name: castName,
                  })}
                  testID={`work-detail-cast-${cast.annictCastId}`}
                />
              );
            })}
          </View>
        </View>
      ) : null}
      {hiddenCount > 0 || expanded ? (
        <TouchableOpacity
          onPress={() => setExpanded((v) => !v)}
          hitSlop={8}
          className="self-start py-1"
          accessibilityRole="button"
          accessibilityLabel={
            expanded
              ? t("スタッフ・キャストの表示を折りたたむ")
              : t("他{{count}}件のスタッフ・キャストを表示", {
                  count: hiddenCount,
                })
          }
          testID="work-detail-credits-toggle"
        >
          <Text className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
            {expanded
              ? t("折りたたむ")
              : t("もっと見る（他{{count}}件）", { count: hiddenCount })}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** Annict の人物・団体ページを外部ブラウザで開くチップ。 */
function CreditChip({
  label,
  url,
  accessibilityLabel,
  testID,
}: {
  label: string;
  url: string;
  accessibilityLabel: string;
  testID: string;
}) {
  return (
    <TouchableOpacity
      onPress={() => void Linking.openURL(url)}
      hitSlop={8}
      className="rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 dark:border-indigo-800 dark:bg-indigo-950"
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <Text className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function WorkDetailSection({
  work,
  creditsInitiallyExpanded,
}: {
  work: WorkDetail;
  creditsInitiallyExpanded: boolean;
}) {
  const { t, i18n } = useTranslation();
  const colors = useThemeColors();

  const episodes =
    work.noEpisodes || work.episodesCount === 0
      ? t("話数未定")
      : t("全{{count}}話", { count: work.episodesCount });
  const rows: { label: string; value: string }[] = [
    { label: t("話数"), value: episodes },
    {
      label: t("視聴者数"),
      value: t("{{countText}}人", {
        count: work.watchersCount,
        countText: work.watchersCount.toLocaleString(i18n.language),
      }),
    },
    ...(work.satisfactionRate != null
      ? [
          {
            label: t("満足度"),
            value: `${Math.round(work.satisfactionRate)}%`,
          },
        ]
      : []),
    ...(work.reviewsCount > 0
      ? [
          {
            label: t("レビュー数"),
            value: t("{{count}} 件", { count: work.reviewsCount }),
          },
        ]
      : []),
  ];

  const links: { label: string; url: string }[] = [
    ...(work.officialSiteUrl
      ? [{ label: t("公式サイト"), url: work.officialSiteUrl }]
      : []),
    ...(work.officialSiteUrlEn
      ? [{ label: t("公式サイト（英語）"), url: work.officialSiteUrlEn }]
      : []),
    ...(work.wikipediaUrl
      ? [{ label: "Wikipedia", url: work.wikipediaUrl }]
      : []),
    ...(work.wikipediaUrlEn
      ? [{ label: t("Wikipedia（英語）"), url: work.wikipediaUrlEn }]
      : []),
    ...(work.twitterUsername
      ? [
          {
            label: `X @${work.twitterUsername}`,
            url: `https://x.com/${work.twitterUsername}`,
          },
        ]
      : []),
    ...(work.twitterHashtag
      ? [
          {
            label: `X #${work.twitterHashtag}`,
            url: `https://x.com/hashtag/${work.twitterHashtag}`,
          },
        ]
      : []),
    // 主導線は animeishi の作品ページ。Annict は外部リンクの一つとして
    // 最後に控えめに置く。
    {
      label: t("Annict で見る"),
      url: annictWorkUrl(work.annictWorkId),
    },
  ];

  return (
    <View className="gap-3">
      <View className="gap-2">
        {rows.map((row) => (
          <DetailRow key={row.label} label={row.label} value={row.value} />
        ))}
      </View>
      <CreditsSection
        key={work.annictWorkId}
        // 詳細クエリは端末の永続キャッシュから復元されるため、フィールド追加
        // 前の応答には staffs / casts が無い。そのまま渡すとクラッシュする
        // ため空配列に正規化する（再取得が終われば新しい応答に置き換わる）。
        staffs={work.staffs ?? []}
        casts={work.casts ?? []}
        initiallyExpanded={creditsInitiallyExpanded}
      />
      {links.length > 0 ? (
        <View className="flex-row flex-wrap gap-x-4 gap-y-1">
          {links.map((link) => (
            <DetailLink
              key={link.url}
              label={link.label}
              url={link.url}
              color={colors.primaryText}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
