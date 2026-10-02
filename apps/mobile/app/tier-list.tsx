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
  shareTierListUrl,
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
      setAssignment((prev) => assignWork(prev, annictWorkId, tierKey));
      setIsDirty(true);
    },
    [],
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
      if (nextYear === year) return;
      confirmIfDirty(() => setYear(nextYear));
    },
    [confirmIfDirty, year],
  );

  const handleChangeSeason = useCallback(
    (nextSeasonKey: SeasonKey) => {
      if (nextSeasonKey === seasonKey) return;
      confirmIfDirty(() => setSeasonKey(nextSeasonKey));
    },
    [confirmIfDirty, seasonKey],
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

  const handleShareUrl = useCallback(async () => {
    setIsSharing(true);
    try {
      const { shareToken } = await saveAndIssueShareToken();
      const result = await shareTierListUrl(buildTierListShareUrl(shareToken));
      // Web 等で共有シートが無い環境はクリップボードに落ちる
      if (result === "copied") {
        alert(
          "リンクをコピーしました",
          "共有リンクを貼り付けて送ってください。",
          { okLabel: "OK" },
        );
      }
    } catch {
      alert("共有に失敗しました", "時間をおいて再度お試しください。", {
        okLabel: "OK",
      });
    } finally {
      setIsSharing(false);
    }
  }, [saveAndIssueShareToken]);

  const handleShareImage = useCallback(async () => {
    setIsSharing(true);
    try {
      const { savedData } = await saveAndIssueShareToken();
      setSnapshotItems(savedData.items);
      // スナップショットの描画と作品画像の読み込みを待つ。
      // 盤面に出ている画像はキャッシュ済みなので、この程度の待ちで足りる。
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (snapshotRef.current) {
        await shareTierListImage(snapshotRef, { dialogTitle: title });
      }
    } catch {
      alert("画像の共有に失敗しました", "時間をおいて再度お試しください。", {
        okLabel: "OK",
      });
    } finally {
      setSnapshotItems(null);
      setIsSharing(false);
    }
  }, [saveAndIssueShareToken, title]);

  const handleShare = useCallback(() => {
    presentTierShareOptions({
      dialogTitle: "Tier 表を共有",
      urlLabel: "URL を共有",
      imageLabel: "画像で共有",
      cancelLabel: "キャンセル",
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
      onShareUrl: () => void handleShareUrl(),
      onShareImage: () => void handleShareImage(),
    });
  }, [handleShareUrl, handleShareImage]);

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
              (isSharing || save.isPending) && styles.saveButtonDisabled,
            ]}
            onPress={handleShare}
            disabled={isSharing || save.isPending}
            accessibilityRole="button"
            accessibilityLabel="tier 表を共有"
            accessibilityState={{ disabled: isSharing || save.isPending }}
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
          />
        </View>
      )}
    </SafeAreaView>
  );
}
