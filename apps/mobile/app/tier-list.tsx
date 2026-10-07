import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { alert, confirm } from "@/lib/dialog";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { SeasonFilter } from "@/components/anime-list/SeasonFilter";
import {
  currentSeasonKey,
  toSeasonParam,
  type SeasonKey,
} from "@/components/anime-list/animeListUtils";
import { TierBoard } from "@/components/tier-list/TierBoard";
import {
  TierBoardSnapshot,
  type SnapshotWork,
} from "@/components/tier-list/TierBoardSnapshot";
import { styles } from "@/components/tier-list/tierListStyles";
import {
  assignWork,
  parseTiersJson,
  toAssignment,
  toSaveItems,
} from "@/lib/tierList/board";
import { DEFAULT_TIERS, defaultTierListTitle } from "@/lib/tierList/defaults";
import {
  buildTierListShareUrl,
  presentTierShareOptions,
  shareTierListImage,
  useTierUrlShare,
} from "@/lib/tierList/share";
import type { TierAssignment, TierRow } from "@/lib/tierList/types";
import { useSeasonWorks } from "@/lib/tierList/useSeasonWorks";
import {
  useSavedTierList,
  useSaveTierList,
  useShareTierList,
} from "@/lib/tierList/useTierList";

/**
 * シーズン単位のアニメ tier 表を作る画面。
 *
 * シーズンの全作品を未分類トレイに並べ、長押しドラッグで各 tier 行へ振り分ける。
 * 保存は明示的な操作（保存ボタン）で行う。ドロップのたびに PUT すると、
 * 数十回の並べ替えがそのまま数十リクエストになるため。
 */
/**
 * 年チップで遡れる年数。tier 表は過去シーズンの振り返りにも使うため、
 * アニメ一覧の既定（12 年）より広く取る。
 */
const TIER_LIST_YEAR_COUNT = 26;

/**
 * 画像キャプチャ前にスナップショットの画像読み込みを待つ上限。
 * これを超えても未読み込みなら欠けたまま撮る（共有自体を失敗させない）。
 */
const SNAPSHOT_WAIT_MAX_MS = 5000;

export default function TierListScreen() {
  const router = useRouter();
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [seasonKey, setSeasonKey] = useState<SeasonKey>(() =>
    currentSeasonKey(),
  );
  const season = toSeasonParam(year, seasonKey);

  const {
    works,
    isLoading: isWorksLoading,
    isError: isWorksError,
    isConnected,
    isConnectionLoading,
  } = useSeasonWorks(season);
  const { data: saved, isLoading: isSavedLoading } = useSavedTierList(season);
  const save = useSaveTierList();
  const share = useShareTierList();

  const [tiers, setTiers] = useState<TierRow[]>(DEFAULT_TIERS);
  const [assignment, setAssignment] = useState<TierAssignment>(new Map());
  const [title, setTitle] = useState(() => defaultTierListTitle(season));
  // 未保存の変更があるか。保存ボタンの活性と「保存済み」表示の出し分けに使う。
  const [isDirty, setIsDirty] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  // 画像エクスポート用。共有時だけ画面外にスナップショットを描画し、
  // キャプチャ後に null で取り除く。
  const [snapshotItems, setSnapshotItems] = useState<SnapshotWork[] | null>(
    null,
  );
  const snapshotRef = useRef<View>(null);
  // 画像共有時に TierBoardSnapshot が全画像の読み込み（成功・失敗問わず）を
  // 終えた合図を受け取る。resolve はレンダー内の onReady から呼ぶので
  // ref 経由で promise に逃がす。
  const snapshotReadyRef = useRef<(() => void) | null>(null);

  // シーズンを切り替えたら、そのシーズンの保存済みデータ（あれば）で状態を差し替える。
  // 保存済みが無ければ既定の tier と空の配置に戻す。
  // ただし編集中（isDirty）は上書きしない。保存後のキャッシュ更新や
  // バックグラウンド refetch で saved が変わっても、未保存の並べ替えを
  // 消さないため。シーズン自体が変わったときは常に反映する。
  const hydratedSeasonRef = useRef(season);
  useEffect(() => {
    if (isSavedLoading) return;
    if (hydratedSeasonRef.current === season && isDirty) return;
    hydratedSeasonRef.current = season;
    if (saved) {
      setTiers(parseTiersJson(saved.tiersJson) ?? DEFAULT_TIERS);
      setAssignment(toAssignment(saved.items));
      setTitle(saved.title);
    } else {
      setTiers(DEFAULT_TIERS);
      setAssignment(new Map());
      setTitle(defaultTierListTitle(season));
    }
    setIsDirty(false);
  }, [saved, isSavedLoading, season, isDirty]);

  const handleAssign = useCallback(
    (annictWorkId: number, tierKey: string | null) => {
      // 共有処理は「盤面を保存 → トークン発行」を直列で行う。
      // その最中に編集が入ると、保存応答後の isDirty 解除や saved の再反映で
      // 共有中に行った編集が消えるため、共有中のドロップは受け付けない。
      if (isSharing) return;
      setAssignment((prev) => assignWork(prev, annictWorkId, tierKey));
      setIsDirty(true);
    },
    [isSharing],
  );

  const handleBack = useCallback(() => {
    const goBack = () => {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace("/(tabs)/anime-list");
    };

    // 保存はドロップごとではなく明示操作なので、未保存のまま離れると
    // 並べ替えが丸ごと消える。破棄する前に一度だけ確認する。
    if (isDirty) {
      confirm(
        "保存していない変更があります",
        "このまま戻ると並べ替えた内容は失われます。",
        goBack,
        {
          confirmLabel: "破棄して戻る",
          cancelLabel: "編集を続ける",
          destructive: true,
        },
      );
      return;
    }
    goBack();
  }, [isDirty, router]);

  // シーズンを変えると上の effect が盤面を丸ごと差し替えるため、
  // 未保存の並べ替えは確認なしに消える。戻るときと同じく一度だけ確認する。
  const confirmIfDirty = useCallback(
    (apply: () => void) => {
      if (!isDirty) {
        apply();
        return;
      }
      confirm(
        "保存していない変更があります",
        "シーズンを切り替えると並べ替えた内容は失われます。",
        apply,
        {
          confirmLabel: "破棄して切り替える",
          cancelLabel: "編集を続ける",
          destructive: true,
        },
      );
    },
    [isDirty],
  );

  const handleChangeYear = useCallback(
    (nextYear: number) => {
      if (isSharing || nextYear === year) return;
      confirmIfDirty(() => setYear(nextYear));
    },
    [confirmIfDirty, isSharing, year],
  );

  const handleChangeSeason = useCallback(
    (nextSeasonKey: SeasonKey) => {
      if (isSharing || nextSeasonKey === seasonKey) return;
      confirmIfDirty(() => setSeasonKey(nextSeasonKey));
    },
    [confirmIfDirty, isSharing, seasonKey],
  );

  const handleSave = useCallback(() => {
    save.mutate(
      { season, title, tiers, items: toSaveItems(assignment, tiers) },
      { onSuccess: () => setIsDirty(false) },
    );
  }, [assignment, save, season, tiers, title]);

  // 共有は「見えている盤面そのもの」を渡したいので、未保存変更があっても
  // 確認ダイアログではなく先に保存してから共有フローへ進む。
  const saveAndIssueShareToken = useCallback(async () => {
    const savedData = await save.mutateAsync({
      season,
      title,
      tiers,
      items: toSaveItems(assignment, tiers),
    });
    setIsDirty(false);
    const { shareToken } = await share.mutateAsync(season);
    return { savedData, shareToken };
  }, [assignment, save, season, share, tiers, title]);

  // web では共有モーダル（コピー / X 共有）、native では OS 共有シート。
  const { shareUrl: presentShareUrl, urlShareElement } = useTierUrlShare({
    tweetText: title,
  });

  const handleShareUrl = useCallback(async () => {
    setIsSharing(true);
    try {
      const { shareToken } = await saveAndIssueShareToken();
      const url = buildTierListShareUrl(shareToken);
      // native は OS 共有シート。web は urlShareElement のモーダルを開き、
      // コピー / X 共有はモーダル内のボタン操作で行う。
      await presentShareUrl(url);
    } catch {
      alert("共有に失敗しました", "時間をおいて再度お試しください。", {
        okLabel: "OK",
      });
    } finally {
      setIsSharing(false);
    }
  }, [presentShareUrl, saveAndIssueShareToken]);

  const handleShareImage = useCallback(async () => {
    setIsSharing(true);
    try {
      const { savedData } = await saveAndIssueShareToken();
      const snapshotReady = new Promise<void>((resolve) => {
        snapshotReadyRef.current = resolve;
      });
      setSnapshotItems(savedData.items);
      // スナップショットの描画と作品画像の読み込み（onReady）を待ってから撮る。
      // タイムアウトを超えたら読み込み途中のまま撮る（共有自体は失敗させない）。
      await Promise.race([
        snapshotReady,
        new Promise((resolve) => setTimeout(resolve, SNAPSHOT_WAIT_MAX_MS)),
      ]);
      // レイアウト確定のため 1 フレーム待つ
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (!snapshotRef.current) {
        throw new Error("スナップショットの描画に失敗しました");
      }
      await shareTierListImage(snapshotRef, { dialogTitle: title });
    } catch {
      alert("画像の共有に失敗しました", "時間をおいて再度お試しください。", {
        okLabel: "OK",
      });
    } finally {
      setSnapshotItems(null);
      setIsSharing(false);
    }
  }, [saveAndIssueShareToken, title]);

  // 共有は「盤面を保存 → トークン発行」を行う。保存済みデータ・作品一覧の
  // 読み込み中（or 取得失敗）に実行すると、初期状態や別シーズンの盤面を
  // 上書き保存してしまうため、データが確定するまで共有を開始させない。
  const shareDisabled =
    isSharing ||
    save.isPending ||
    isSavedLoading ||
    isWorksLoading ||
    isWorksError;

  const handleShare = useCallback(() => {
    if (shareDisabled) return;
    presentTierShareOptions({
      dialogTitle: "Tier 表を共有",
      urlLabel: "URL を共有",
      imageLabel: "画像で共有",
      cancelLabel: "キャンセル",
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
      onShareUrl: () => void handleShareUrl(),
      onShareImage: () => void handleShareImage(),
    });
  }, [handleShareUrl, handleShareImage, shareDisabled]);

  // 戻る導線は盤面・ローディング・ソフトゲートの全分岐に必要なので切り出す
  // （どの状態でも画面に閉じ込められないようにするため）。
  const backBar = (
    <View style={styles.headerTop}>
      <TouchableOpacity
        onPress={handleBack}
        style={styles.backButton}
        accessibilityRole="button"
        accessibilityLabel="戻る"
        testID="tier-list-back"
      >
        <Text style={styles.backButtonText}>‹ 戻る</Text>
      </TouchableOpacity>
    </View>
  );

  if (isConnectionLoading) {
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>{backBar}</View>
        <View style={styles.centered}>
          <ActivityIndicator color="#9ca3af" />
        </View>
      </SafeAreaView>
    );
  }

  if (!isConnected) {
    // シーズン作品の取得は /works/search 経由で Annict トークン必須。
    // 未連携では盤面自体が空になるため、連携誘導を最優先で出す。
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>{backBar}</View>
        <AnnictSoftGate
          description="Tier 表の作成には Annict との連携が必要です。連携するとシーズンの全作品を並べ替えられます。"
          testID="tier-list-soft-gate"
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        {backBar}
        <Text style={styles.headerTitle}>{title}</Text>
        <Text style={styles.headerHint}>
          作品を長押ししてドラッグすると tier を移動できます
        </Text>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[
              styles.shareButton,
              shareDisabled && styles.saveButtonDisabled,
            ]}
            onPress={handleShare}
            disabled={shareDisabled}
            accessibilityRole="button"
            accessibilityLabel="tier 表を共有"
            accessibilityState={{ disabled: shareDisabled }}
            testID="tier-list-share"
          >
            {isSharing ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>共有</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.saveButton,
              (!isDirty || save.isPending) && styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!isDirty || save.isPending}
            accessibilityRole="button"
            accessibilityLabel="tier 表を保存"
            accessibilityState={{ disabled: !isDirty || save.isPending }}
            testID="tier-list-save"
          >
            {save.isPending ? (
              <ActivityIndicator size="small" color="#ffffff" />
            ) : (
              <Text style={styles.saveButtonText}>
                {isDirty ? "保存" : "保存済み"}
              </Text>
            )}
          </TouchableOpacity>
          {save.isError && (
            <Text style={styles.centeredText}>保存に失敗しました</Text>
          )}
        </View>
      </View>

      <SeasonFilter
        year={year}
        season={seasonKey}
        onChangeYear={handleChangeYear}
        onChangeSeason={handleChangeSeason}
        yearCount={TIER_LIST_YEAR_COUNT}
      />

      {isWorksError ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            シーズンの作品を取得できませんでした
          </Text>
        </View>
      ) : isWorksLoading || isSavedLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#9ca3af" />
          <Text style={styles.centeredText}>シーズンの作品を集めています</Text>
        </View>
      ) : works.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            このシーズンの作品が見つかりませんでした
          </Text>
        </View>
      ) : (
        <TierBoard
          tiers={tiers}
          works={works}
          assignment={assignment}
          onAssign={handleAssign}
        />
      )}

      {/*
        画像共有用のスナップショット。画面外に置いて常時非表示にし、
        共有実行の瞬間だけ描画 → キャプチャ → 破棄する。
        中身は保存済みデータ（sharedData.items）なので、共有リンク先と
        同じ内容が画像になる。
      */}
      {snapshotItems && (
        <View style={styles.snapshotOffscreen}>
          <TierBoardSnapshot
            ref={snapshotRef}
            title={title}
            tiers={tiers}
            items={snapshotItems}
            onReady={() => snapshotReadyRef.current?.()}
          />
        </View>
      )}

      {/* web のみ共有モーダル（native は null が返る） */}
      {urlShareElement}
    </SafeAreaView>
  );
}
