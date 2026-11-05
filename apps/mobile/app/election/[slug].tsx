import { Fragment } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  Text,
  TouchableOpacity,
  useColorScheme,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMarkdown } from "react-native-marked";
import { SafeAreaView } from "@/components/ui/SafeAreaView";
import { BackButton } from "@/components/ui";
import { WorkImage } from "@/components/anime-list/WorkImage";
import {
  useElection,
  useElectionVote,
  useCancelElectionVote,
} from "@/lib/useElections";
import type { ElectionCandidate, ElectionDetail } from "@/lib/useElections";
import { formatEventPeriod, eventPhase } from "@/lib/eventPeriod";
import { useThemeColors } from "@/lib/theme";

// 総選挙の詳細（issue #438）。ホームの総選挙枠（ElectionRail）から遷移する。
// 候補をタップして投票する。1 アカウント 1 票で、期間中は別の候補を
// 選び直せる。途中経過は出さず、終了後の結果は特集記事で発表される。
export default function ElectionScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ slug?: string }>();
  const slug = typeof params.slug === "string" ? params.slug : null;

  const detail = useElection(slug);
  const data = detail.data;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace("/");
  };

  return (
    <SafeAreaView
      className="flex-1 bg-white dark:bg-slate-900"
      edges={["bottom"]}
    >
      <Stack.Screen
        options={{
          title: data?.title ?? "総選挙",
          headerBackVisible: false,
          headerLeft: () => (
            <BackButton
              onPress={handleBack}
              accessibilityLabel="戻る"
              testID="election-back"
            />
          ),
        }}
      />
      {slug === null || detail.isError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text
            className="text-center text-slate-500 dark:text-slate-400"
            testID="election-not-found"
          >
            この総選挙は表示できません
          </Text>
        </View>
      ) : detail.isLoading || !data ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={colors.textMuted} />
        </View>
      ) : (
        <ElectionBody slug={data.slug} election={data} />
      )}
    </SafeAreaView>
  );
}

function ElectionBody({
  slug,
  election,
}: {
  slug: string;
  election: ElectionDetail;
}) {
  const colors = useThemeColors();
  const colorScheme = useColorScheme();
  const vote = useElectionVote();
  const cancelVote = useCancelElectionVote();

  const elements = useMarkdown(election.body ?? "", {
    colorScheme: colorScheme ?? "light",
    theme: {
      colors: {
        text: colors.textSecondary,
        link: colors.primaryText,
        code: colors.surfaceMuted,
        border: colors.border,
      },
    },
    styles: {
      text: { color: colors.textSecondary },
    },
  });

  const castVote = (candidateId: number) => {
    vote.mutate(
      { slug, candidateId },
      {
        onError: () => Alert.alert("エラー", "投票に失敗しました"),
      },
    );
  };

  const withdrawVote = () => {
    cancelVote.mutate(
      { slug },
      {
        onError: () => Alert.alert("エラー", "投票の取り消しに失敗しました"),
      },
    );
  };

  const phase = eventPhase(election.startsAt, election.endsAt);
  const pending = vote.isPending || cancelVote.isPending;

  return (
    <ScrollView className="flex-1">
      <View className="w-full max-w-2xl self-center px-6 pb-16 pt-4">
        {election.coverImageUrl ? (
          <WorkImage
            uri={election.coverImageUrl}
            style={{
              width: "100%",
              aspectRatio: 16 / 9,
              borderRadius: 12,
              backgroundColor: colors.surfaceMuted,
            }}
            placeholder=<View className="aspect-video w-full items-center justify-center rounded-xl bg-indigo-100 dark:bg-indigo-900" />
          />
        ) : null}
        <Text
          className="mt-4 text-2xl font-bold text-slate-900 dark:text-slate-100"
          testID="election-title"
        >
          {election.title}
        </Text>
        <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          投票期間: {formatEventPeriod(election.startsAt, election.endsAt)}
        </Text>

        <VotingNotice
          phase={phase}
          voted={election.votedCandidateId !== null}
          pending={pending}
          onCancel={withdrawVote}
        />

        <View className="mt-6" testID="election-candidates">
          {election.candidates.map((candidate) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              votable={phase === "ongoing"}
              voted={election.votedCandidateId === candidate.id}
              pending={pending}
              onVote={() => castVote(candidate.id)}
            />
          ))}
        </View>

        {election.body ? (
          <View className="mt-6">
            {elements.map((element, index) => (
              <Fragment key={index}>{element}</Fragment>
            ))}
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

// 投票ステータスの案内。期間外では候補を選べない旨と、終了後は結果が
// 特集で発表される旨を出す。投票済みなら取り消し導線もここに置く。
function VotingNotice({
  phase,
  voted,
  pending,
  onCancel,
}: {
  phase: ReturnType<typeof eventPhase>;
  voted: boolean;
  pending: boolean;
  onCancel: () => void;
}) {
  return (
    <View className="mt-4 flex-row items-center gap-3">
      {phase === "before" ? (
        <Text
          className="text-sm text-slate-500 dark:text-slate-400"
          testID="election-notice"
        >
          投票期間が始まったら候補を選べます
        </Text>
      ) : phase === "ended" ? (
        <Text
          className="text-sm text-slate-500 dark:text-slate-400"
          testID="election-notice"
        >
          投票は終了しました。結果は特集で発表します
        </Text>
      ) : voted ? (
        <>
          <Text
            className="text-sm font-semibold text-indigo-500 dark:text-indigo-300"
            testID="election-notice"
          >
            投票済み（期間中は選び直せます）
          </Text>
          <TouchableOpacity
            onPress={onCancel}
            disabled={pending}
            accessibilityRole="button"
            accessibilityLabel="投票を取り消す"
            testID="election-cancel-vote"
          >
            <Text className="text-sm text-slate-400 dark:text-slate-500">
              取り消す
            </Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text
          className="text-sm text-slate-500 dark:text-slate-400"
          testID="election-notice"
        >
          推しの候補を 1 つ選んでください
        </Text>
      )}
      {pending ? <ActivityIndicator size="small" /> : null}
    </View>
  );
}

// 候補 1 行（画像 + 表示名 + 投票ボタン）。表示名と画像は投入時に
// 書き写した値をそのまま出す（Annict キャッシュに無い候補も出せる）。
// 得票数は出さない（途中経過は公開しない決定）。
const CANDIDATE_IMAGE_SIZE = 64;

function CandidateRow({
  candidate,
  votable,
  voted,
  pending,
  onVote,
}: {
  candidate: ElectionCandidate;
  votable: boolean;
  voted: boolean;
  pending: boolean;
  onVote: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View
      className="flex-row items-center gap-3 border-b border-slate-100 py-3 dark:border-slate-800"
      testID={`election-candidate-${candidate.id}`}
    >
      <WorkImage
        uri={candidate.imageUrl}
        style={{
          width: CANDIDATE_IMAGE_SIZE,
          height: CANDIDATE_IMAGE_SIZE,
          borderRadius: 8,
          backgroundColor: colors.surfaceMuted,
        }}
        placeholder={
          <View
            style={{
              width: CANDIDATE_IMAGE_SIZE,
              height: CANDIDATE_IMAGE_SIZE,
            }}
            className="items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-900"
          >
            <Text className="text-xs text-indigo-400 dark:text-indigo-300">
              {candidate.kind === "character" ? "キャラ" : "作品"}
            </Text>
          </View>
        }
      />
      <View className="flex-1">
        <Text
          className="text-base font-medium text-slate-900 dark:text-slate-100"
          numberOfLines={2}
        >
          {candidate.name}
        </Text>
      </View>
      {votable ? (
        voted ? (
          <View
            className="rounded-lg bg-indigo-600 px-4 py-2 dark:bg-indigo-500"
            testID={`election-voted-badge-${candidate.id}`}
          >
            <Text className="font-semibold text-white">投票済み</Text>
          </View>
        ) : (
          <TouchableOpacity
            onPress={onVote}
            disabled={pending}
            className="rounded-lg border border-indigo-500 px-4 py-2 dark:border-indigo-400"
            accessibilityRole="button"
            accessibilityLabel={`${candidate.name}に投票する`}
            testID={`election-vote-${candidate.id}`}
          >
            <Text className="font-semibold text-indigo-500 dark:text-indigo-300">
              投票する
            </Text>
          </TouchableOpacity>
        )
      ) : null}
    </View>
  );
}
