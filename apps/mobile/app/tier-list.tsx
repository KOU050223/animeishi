import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
  type ViewInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { apiUrl } from "@/lib/apiUrl";
import { alert, confirm } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { SeasonFilter } from "@/components/anime-list/SeasonFilter";
import {
  adjacentSeasonParams,
  currentSeason,
  toSeasonParam,
  type SeasonKey,
} from "@/components/anime-list/animeListUtils";
import { TierBoard } from "@/components/tier-list/TierBoard";
import {
  TierBoardSnapshot,
  type SnapshotItem,
} from "@/components/tier-list/TierBoardSnapshot";
import { useTierListStyles } from "@/components/tier-list/tierListStyles";
import { useThemeColors } from "@/lib/theme";
import {
  assignItem,
  mergeBoardItems,
  parseTiersJson,
  toAssignment,
  toSaveItems,
} from "@/lib/tierList/board";
import { DEFAULT_TIERS, defaultTierListTitle } from "@/lib/tierList/defaults";
import { renameTier } from "@/lib/tierList/label";
import {
  buildTierListShareUrl,
  captureTierListImageFile,
  presentTierShareOptions,
  shareTierListImage,
  useTierUrlShare,
} from "@/lib/tierList/share";
import type { TierAssignment, TierItem, TierRow } from "@/lib/tierList/types";
import { useSeasonWorks } from "@/lib/tierList/useSeasonWorks";
import { usePrefetchSeasonWorks } from "@/lib/useAnimeList";
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
 * 画像キャプチャ前にスナップショットの画像読み込みを待つ上限。
 * これを超えても未読み込みなら欠けたまま撮る（共有自体を失敗させない）。
 */
const SNAPSHOT_WAIT_MAX_MS = 5000;

export default function TierListScreen() {
  const router = useRouter();
  const styles = useTierListStyles();
  const colors = useThemeColors();
  const [year, setYear] = useState(() => currentSeason().year);
  const [seasonKey, setSeasonKey] = useState<SeasonKey>(
    () => currentSeason().key,
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

  // 前後シーズンを先読みしてシーズン切り替え直後の待ちを消す（issue #173）。
  // シーズン作品のキャッシュキーはアニメ一覧画面と共有しているため、
  // ここでのプリフェッチは一覧側にも効く（逆も同じ）。
  usePrefetchSeasonWorks(
    adjacentSeasonParams(year, seasonKey),
    isConnected && !isWorksLoading,
  );
  const save = useSaveTierList();
  const share = useShareTierList();

  const [tiers, setTiers] = useState<TierRow[]>(DEFAULT_TIERS);
  const [assignment, setAssignment] = useState<TierAssignment>(new Map());
  // ＋ボタンの検索シートから手動追加した作品（issue #168）。
  // シーズン候補（works）に載らない作品を未分類トレイへ並べるための追加枠。
  // 未配置のままでは保存対象にならずリロードで消えるので、シーズン切替時に
  // まとめてクリアする。
  const [manualWorks, setManualWorks] = useState<TierItem[]>([]);
  const [title, setTitle] = useState(() => defaultTierListTitle(season));
  // 未保存の変更があるか。保存ボタンの活性と「保存済み」表示の出し分けに使う。
  const [isDirty, setIsDirty] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  // 画像エクスポート用。共有時だけ画面外にスナップショットを描画し、
  // キャプチャ後に null で取り除く。
  const [snapshotItems, setSnapshotItems] = useState<SnapshotItem[] | null>(
    null,
  );
  const snapshotRef = useRef<ViewInstance>(null);
  // 画像共有時に TierBoardSnapshot が全画像の読み込み（成功・失敗問わず）を
  // 終えた合図を受け取る。resolve はレンダー内の onReady から呼ぶので
  // ref 経由で promise に逃がす。
  const snapshotReadyRef = useRef<(() => void) | null>(null);
  // 保存データの組み立て元。保存は確認ダイアログや共有フローを挟むため、
  // ボタンを押した時点ではなく承認・実行の時点の盤面を送れるよう
  // 最新値を ref に逃がす（確認表示中の編集が古い配置で上書きされない）。
  const saveSourceRef = useRef({ season, title, tiers, assignment });
  useEffect(() => {
    saveSourceRef.current = { season, title, tiers, assignment };
  });

  // シーズンを切り替えたら、そのシーズンの保存済みデータ（あれば）で状態を差し替える。
  // 保存済みが無ければ既定の tier と空の配置に戻す。
  // ただし編集中（isDirty）は上書きしない。保存後のキャッシュ更新や
  // バックグラウンド refetch で saved が変わっても、未保存の並べ替えを
  // 消さないため。シーズン自体が変わったときは常に反映する。
  // effect での同期 setState を避けるためレンダー中に調整する。
  // 適用済みのキー（シーズン + 保存データ）を覚え、元の effect と同じ
  // タイミング（シーズン変更、または未編集中の saved 更新）だけ再適用する。
  const [hydrated, setHydrated] = useState<{
    season: typeof season;
    saved: typeof saved;
  } | null>(null);
  if (
    !isSavedLoading &&
    (hydrated?.season !== season || (!isDirty && hydrated.saved !== saved))
  ) {
    setHydrated({ season, saved });
    if (saved) {
      setTiers(parseTiersJson(saved.tiersJson) ?? DEFAULT_TIERS);
      setAssignment(
        toAssignment(
          saved.items.map((i) => ({
            itemId: i.annictWorkId,
            tierKey: i.tierKey,
          })),
        ),
      );
      setTitle(saved.title);
    } else {
      setTiers(DEFAULT_TIERS);
      setAssignment(new Map());
      setTitle(defaultTierListTitle(season));
    }
    setIsDirty(false);
  }

  // 盤面に並べる作品集合。シーズン候補（works）を本体に、2 種類を補完する:
  // - 保存済み items のうちシーズン外の作品。過去に手動追加→配置→保存した
  //   作品は season 検索に出ないので、works だけでは worksInTier が
  //   作品を引けず「配置済みなのに描画されない」状態になる。
  // - manualWorks（今回手動追加した作品。未配置のものも含む）。
  const boardWorks = useMemo<TierItem[]>(
    () =>
      mergeBoardItems(
        works,
        (saved?.items ?? []).map((item) => ({
          id: item.annictWorkId,
          title: item.title,
          imageUrl: item.hostedImageUrl,
        })),
        manualWorks,
      ),
    [works, saved, manualWorks],
  );

  const handleAssign = useCallback(
    (itemId: number, tierKey: string | null, beforeItemId?: number) => {
      // 共有・保存は「盤面を保存 → 応答を反映」を直列で行う。
      // その最中に編集が入ると、保存応答後の isDirty 解除や saved の再反映で
      // 処理中に行った編集が消えるため、リクエスト中のドロップは受け付けない。
      if (isSharing || save.isPending) return;
      setAssignment((prev) => assignItem(prev, itemId, tierKey, beforeItemId));
      setIsDirty(true);
    },
    [isSharing, save.isPending],
  );

  // 検索シートから選ばれた作品を未分類トレイ（works 側）へ追加する。
  // 追加だけでは保存 items に載らないため、配置までが一連の編集になる。
  const handleAddWork = useCallback(
    (work: TierItem) => {
      // ドロップと同じく、共有・保存中の編集は受け付けない。
      if (isSharing || save.isPending) return;
      // 既に盤面にある作品（シーズン候補・保存済み・追加済み）は無視する。
      if (boardWorks.some((w) => w.id === work.id)) return;
      // 作品の追加（issue #214）。重複・共有中の早期 return より後で送る。
      trackEvent("tier_work_add");
      setManualWorks((prev) => [...prev, work]);
      setIsDirty(true);
    },
    [isSharing, save.isPending, boardWorks],
  );

  const handleRenameTier = useCallback(
    (tierKey: string, label: string) => {
      // ドロップと同じく、共有・保存中の編集は受け付けない。
      // ここで tiers を変えると保存応答の反映で消えるため。
      if (isSharing || save.isPending) return;
      // trim 後に名前が変わっていない（or 存在しない key）なら差分なし。
      // renameTier が同じ配列を返すので、その場合は未保存扱いにしない。
      const next = renameTier(tiers, tierKey, label);
      if (next === tiers) return;
      setTiers(next);
      setIsDirty(true);
    },
    [isSharing, save.isPending, tiers],
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

  const handleChangeSeason = useCallback(
    (nextYear: number, nextSeasonKey: SeasonKey) => {
      if (isSharing || (nextYear === year && nextSeasonKey === seasonKey)) {
        return;
      }
      confirmIfDirty(() => {
        setYear(nextYear);
        setSeasonKey(nextSeasonKey);
        // 手動追加はシーズン単位の編集なので、切替先へ持ち越さない。
        setManualWorks([]);
      });
    },
    [confirmIfDirty, isSharing, year, seasonKey],
  );

  // ボード層の汎用 itemId を作品用フィールド名（annictWorkId）に写す。
  // キャラクター版は annictCharacterId に写すため、ここで分岐する。
  const handleSave = useCallback(() => {
    // 承認コールバックはダイアログを開いた時点ではなく承認時点の盤面で
    // 保存する（確認の表示中に配置を変えても古い配置で上書きされない）。
    const doSave = () => {
      const cur = saveSourceRef.current;
      save.mutate(
        {
          season: cur.season,
          title: cur.title,
          tiers: cur.tiers,
          items: toSaveItems(cur.assignment, cur.tiers).map((i) => ({
            annictWorkId: i.itemId,
            tierKey: i.tierKey,
          })),
        },
        {
          onSuccess: () => {
            setIsDirty(false);
            // 保存対象外だった未配置の追加分は盤面からも取り除く。
            // 残しておくと「保存済み」表示と矛盾し、再表示で消える。
            setManualWorks((prev) =>
              prev.filter((w) => cur.assignment.has(w.id)),
            );
          },
        },
      );
    };
    // ＋で追加したがどの tier にも配置していない作品は保存対象にならず、
    // 画面を離れると消える。「保存したのに消えた」を防ぐため一度だけ確認する。
    const hasUnassignedManual = manualWorks.some((w) => !assignment.has(w.id));
    if (hasUnassignedManual) {
      confirm(
        "未配置の追加作品があります",
        "未分類に残っている追加分は保存されず、このままだと消えます。",
        doSave,
        { confirmLabel: "このまま保存", cancelLabel: "編集を続ける" },
      );
      return;
    }
    doSave();
  }, [assignment, manualWorks, save]);

  // 共有は「見えている盤面そのもの」を渡したいので、未保存変更があっても
  // 確認ダイアログではなく先に保存してから共有フローへ進む。
  const saveTierListData = useCallback(async () => {
    // 共有フローは isSharing で編集を止めるが、開始直前までの編集も
    // 反映できるよう実行時点の最新値から組み立てる。
    const cur = saveSourceRef.current;
    const savedData = await save.mutateAsync({
      season: cur.season,
      title: cur.title,
      tiers: cur.tiers,
      items: toSaveItems(cur.assignment, cur.tiers).map((i) => ({
        annictWorkId: i.itemId,
        tierKey: i.tierKey,
      })),
    });
    setIsDirty(false);
    // 保存ボタンと同じく、保存に載らなかった未配置の追加分は盤面から外す。
    setManualWorks((prev) => prev.filter((w) => cur.assignment.has(w.id)));
    return savedData;
  }, [save]);

  // withRenderedSnapshot は try/finally を含むため react/memo-dependencies が
  // deps を余剰と誤検知する。初回キャプチャに固定しないよう ref 経由で
  // 最新の saveTierListData を呼ぶ。
  const saveTierListDataRef = useRef(saveTierListData);
  useEffect(() => {
    saveTierListDataRef.current = saveTierListData;
  });

  // web では共有モーダル（コピー / X 共有 / 画像）、native では
  // OS 共有シート。generateImageFile は web のモーダルでのみ使われる。
  // generateImageFile は宣言より後でしか呼ばれないため、ここで参照してよい。
  const { shareUrl: presentShareUrl, urlShareElement } = useTierUrlShare({
    tweetText: title,
    generateImageFile: () => generateImageFile(),
  });

  const handleShareUrl = useCallback(async () => {
    setIsSharing(true);
    try {
      await saveTierListData();
      const { shareToken } = await share.mutateAsync(season);
      const url = buildTierListShareUrl(shareToken, apiUrl);
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
  }, [presentShareUrl, saveTierListData, share, season]);

  // 盤面を保存し、保存結果をスナップショットに描画させてから run を実行する
  // 共通処理。画像には共有 URL が要らないためトークン発行はしない。
  const withRenderedSnapshot = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      setIsSharing(true);
      try {
        const savedData = await saveTierListDataRef.current();
        const snapshotReady = new Promise<void>((resolve) => {
          snapshotReadyRef.current = resolve;
        });
        setSnapshotItems(
          savedData.items.map((i) => ({
            id: i.annictWorkId,
            tierKey: i.tierKey,
            title: i.title,
            imageUrl: i.hostedImageUrl,
          })),
        );
        // スナップショットの描画と作品画像の読み込み（onReady）を待ってから
        // 撮る。タイムアウトを超えたら読み込み途中のまま撮る
        // （共有自体は失敗させない）。
        await Promise.race([
          snapshotReady,
          new Promise((resolve) => setTimeout(resolve, SNAPSHOT_WAIT_MAX_MS)),
        ]);
        // レイアウト確定のため 1 フレーム待つ
        await new Promise((resolve) => requestAnimationFrame(resolve));
        if (!snapshotRef.current) {
          throw new Error("スナップショットの描画に失敗しました");
        }
        return await run();
      } finally {
        setSnapshotItems(null);
        setIsSharing(false);
      }
    },
    [],
  );

  const handleShareImage = useCallback(async () => {
    try {
      // 共有画像は撮影時点のスキームに合わせる（盤面と同じ見た目の画像にする）
      await withRenderedSnapshot(() =>
        shareTierListImage(snapshotRef, {
          dialogTitle: title,
          backgroundColor: colors.background,
        }),
      );
    } catch {
      alert("画像の共有に失敗しました", "時間をおいて再度お試しください。", {
        okLabel: "OK",
      });
    }
  }, [withRenderedSnapshot, title, colors]);

  // web 共有モーダル用: PNG 化した画像 File を生成して返す。
  // 共有・ダウンロードへの受け渡しはモーダル側の別ボタンが行う
  // （生成待ちの後に navigator.share を呼ぶとユーザー操作期限で失敗するため）。
  const generateImageFile = useCallback(() => {
    // web 共有モーダルの「画像を生成する」押下を計測する（issue #214）。
    trackEvent("tier_image_generate");
    return withRenderedSnapshot(() =>
      captureTierListImageFile(snapshotRef, {
        title,
        backgroundColor: colors.background,
      }),
    );
  }, [withRenderedSnapshot, title, colors]);

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
    // 共有ボタンの押下と、続く選択肢の方式（issue #214）を計測する。
    trackEvent("tier_share_open");
    presentTierShareOptions({
      dialogTitle: "Tier 表を共有",
      urlLabel: "URL を共有",
      imageLabel: "画像で共有",
      cancelLabel: "キャンセル",
      // 方式の計測は選択肢を実際に提示する側（options.native.ts / Web は
      // モーダル内の各ボタン）で行う。ここで送ると Web でモーダルを
      // 開いただけなのに method:url が記録されてしまう。
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
      onShareUrl: () => void handleShareUrl(),
      // eslint-disable-next-line no-void -- コールバックは同期シグネチャ、処理は非同期
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
          <ActivityIndicator color={colors.textMuted} />
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
          surface="tier_list"
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
          作品を長押ししてドラッグすると tier を移動できます。tier
          名はタップで変更できます
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
        onChange={handleChangeSeason}
      />

      {isWorksError ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            シーズンの作品を取得できませんでした
          </Text>
        </View>
      ) : isWorksLoading || isSavedLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textMuted} />
          <Text style={styles.centeredText}>シーズンの作品を集めています</Text>
        </View>
      ) : (
        // シーズン候補が 0 件でも盤面を出す。＋ボタンから手動追加できる
        // 道を残すため（issue #168）、空のときだけ別画面にはしない。
        <TierBoard
          tiers={tiers}
          items={boardWorks}
          assignment={assignment}
          onAssign={handleAssign}
          onRenameTier={handleRenameTier}
          onAddItem={handleAddWork}
          labelsEditable={!isSharing && !save.isPending}
          trayEmptyLabel="すべての作品を配置しました"
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
