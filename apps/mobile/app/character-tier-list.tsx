import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Text,
  TouchableOpacity,
  View,
  type ViewInstance,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { apiUrl } from "@/lib/apiUrl";
import { alert, confirm } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { AnnictSoftGate } from "@/components/AnnictSoftGate";
import { TierBoard } from "@/components/tier-list/TierBoard";
import {
  TierBoardSnapshot,
  type SnapshotItem,
} from "@/components/tier-list/TierBoardSnapshot";
import { useTierListStyles } from "@/components/tier-list/tierListStyles";
import { useThemeColors } from "@/lib/theme";
import {
  assignItem,
  parseTiersJson,
  sameBoard,
  toAssignment,
  toSaveItems,
} from "@/lib/tierList/board";
import {
  DEFAULT_TIERS,
  defaultCharacterTierListTitle,
} from "@/lib/tierList/defaults";
import { renameTier } from "@/lib/tierList/label";
import {
  buildCharacterTierListShareUrl,
  captureTierListImageFile,
  presentTierShareOptions,
  shareTierListImage,
  useTierUrlShare,
} from "@/lib/tierList/share";
import type { TierAssignment, TierRow } from "@/lib/tierList/types";
import { useWorkCharacters } from "@/lib/tierList/useWorkCharacters";
import {
  useSavedCharacterTierList,
  useSaveCharacterTierList,
  useShareCharacterTierList,
} from "@/lib/tierList/useCharacterTierList";

/**
 * 作品単位のキャラクター tier 表を作る画面（issue #169）。
 *
 * tier-list.tsx（シーズン内の作品版）と同じ盤面・保存・共有の仕組みを
 * キャラクター名簿向けに組み替えたもの。違いは:
 * - 名簿の取得元が useWorkCharacters（作品のキャスト一覧）であること
 * - 保存スコープのキーが season ではなく annictWorkId であること
 * - シーズン切替 UI がないこと（対象作品は一覧画面からの遷移で確定する）
 */
/**
 * 画像キャプチャ前にスナップショットの画像読み込みを待つ上限。
 * これを超えても未読み込みなら欠けたまま撮る（共有自体を失敗させない）。
 */
const SNAPSHOT_WAIT_MAX_MS = 5000;

export default function CharacterTierListScreen() {
  const router = useRouter();
  const styles = useTierListStyles();
  const colors = useThemeColors();
  const params = useLocalSearchParams<{
    workId?: string;
    workTitle?: string;
  }>();
  const annictWorkId = Number(params.workId);
  // workId が数値でない（ディープリンク等の異常系）場合は名簿を取りに行かない
  const validWorkId = Number.isFinite(annictWorkId) && annictWorkId > 0;

  const {
    characters,
    workTitle: fetchedWorkTitle,
    isLoading: isCharactersLoading,
    isError: isCharactersError,
    isConnected,
    isConnectionLoading,
  } = useWorkCharacters(validWorkId ? annictWorkId : null);
  const {
    data: saved,
    isLoading: isSavedLoading,
    isError: isSavedError,
  } = useSavedCharacterTierList(annictWorkId);
  const save = useSaveCharacterTierList();
  const share = useShareCharacterTierList();

  // 作品タイトルは「遷移パラメータ > API 応答」の順で使う
  // （パラメータは一覧画面から渡される確実な値のため優先）。
  const workTitle = params.workTitle ?? fetchedWorkTitle;

  const [tiers, setTiers] = useState<TierRow[]>(DEFAULT_TIERS);
  const [assignment, setAssignment] = useState<TierAssignment>(new Map());
  const [title, setTitle] = useState(() =>
    defaultCharacterTierListTitle(workTitle),
  );
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

  // 保存成功コールバックは送信時点の state を掴むため、現在の盤面は
  // ref 経由で読む（保存中の編集を「保存済み」に誤認しないための比較用）。
  // render 中に ref を書き換えられないため、コミット後の effect で同期する。
  const boardStateRef = useRef({ title, tiers, assignment });
  useEffect(() => {
    boardStateRef.current = { title, tiers, assignment };
  });

  // 保存済み tier 表が届いたら盤面へ流し込む（この画面の作品は固定で一度だけ）。
  // ただし編集中（isDirty）は上書きしない。保存後のキャッシュ更新や
  // バックグラウンド refetch で saved が変わっても、未保存の並べ替えを消さないため。
  // 取得に失敗したときは hydrate しない — 空の盤面を確定させてしまうと、
  // 続く保存・共有が既存の配置を空で上書きするため。
  // effect での同期 setState を避けるためレンダー中に調整する。
  const [hydrated, setHydrated] = useState(false);
  if (!isSavedLoading && !isSavedError && !hydrated && !(saved && isDirty)) {
    setHydrated(true);
    if (saved) {
      setTiers(parseTiersJson(saved.tiersJson) ?? DEFAULT_TIERS);
      setAssignment(
        toAssignment(
          saved.items.map((i) => ({
            itemId: i.annictCharacterId,
            tierKey: i.tierKey,
          })),
        ),
      );
      setTitle(saved.title);
    }
    setIsDirty(false);
  }

  // 作品タイトルが遅れて届いた場合、既定タイトルだけを差し替える
  // （保存済みタイトルやユーザーが付けた名前は上書きしない）。
  // 保存済み表が無い作品では hydrate 済みでも既定タイトルのままなので、
  // ディープリンク等で workTitle が後から届いても反映できるようにする。
  const [titleSyncKey, setTitleSyncKey] = useState({ workTitle, saved });
  if (titleSyncKey.workTitle !== workTitle || titleSyncKey.saved !== saved) {
    setTitleSyncKey({ workTitle, saved });
    if (workTitle && !saved) {
      setTitle((prev) =>
        prev === defaultCharacterTierListTitle(null)
          ? defaultCharacterTierListTitle(workTitle)
          : prev,
      );
    }
  }

  const handleAssign = useCallback(
    (itemId: number, tierKey: string | null, beforeItemId?: number) => {
      // 共有処理は「盤面を保存 → トークン発行」を直列で行う。
      // その最中に編集が入ると、保存応答後の isDirty 解除や saved の再反映で
      // 共有中に行った編集が消えるため、共有中のドロップは受け付けない。
      // 保存中の編集は isDirty が立ったまま残る（handleSave 側で送信盤面と
      // 現在盤面を比較して一致したときだけ解除するため）。
      if (isSharing) return;
      setAssignment((prev) => assignItem(prev, itemId, tierKey, beforeItemId));
      setIsDirty(true);
    },
    [isSharing],
  );

  const handleRenameTier = useCallback(
    (tierKey: string, label: string) => {
      if (isSharing) return;
      const next = renameTier(tiers, tierKey, label);
      if (next === tiers) return;
      setTiers(next);
      setIsDirty(true);
    },
    [isSharing, tiers],
  );

  const handleBack = useCallback(() => {
    const goBack = () => {
      if (router.canGoBack()) {
        router.back();
        return;
      }
      router.replace("/(tabs)/library?section=anime");
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

  const handleSave = useCallback(() => {
    // 送信した盤面をスナップショットとして取る。保存中に編集が進むと
    // 応答は送信時点の内容しか含まないため、現在の盤面と一致するとき
    // だけ「保存済み」（isDirty 解除）にする。
    const sentSnapshot = {
      title,
      tiers,
      items: toSaveItems(assignment, tiers),
    };
    save.mutate(
      {
        annictWorkId,
        title,
        tiers,
        items: sentSnapshot.items.map((i) => ({
          annictCharacterId: i.itemId,
          tierKey: i.tierKey,
        })),
      },
      {
        onSuccess: () => {
          const current = boardStateRef.current;
          const unchanged = sameBoard(sentSnapshot, {
            title: current.title,
            tiers: current.tiers,
            items: toSaveItems(current.assignment, current.tiers),
          });
          if (unchanged) setIsDirty(false);
        },
      },
    );
  }, [annictWorkId, assignment, save, tiers, title]);

  // 共有は「見えている盤面そのもの」を渡したいので、未保存変更があっても
  // 確認ダイアログではなく先に保存してから共有フローへ進む。
  const saveTierListData = useCallback(async () => {
    // 共有フローは isSharing で編集を止めるが、開始直前までの編集も
    // 反映できるよう実行時点の最新値から組み立てる。
    const cur = boardStateRef.current;
    const savedData = await save.mutateAsync({
      annictWorkId,
      title: cur.title,
      tiers: cur.tiers,
      items: toSaveItems(cur.assignment, cur.tiers).map((i) => ({
        annictCharacterId: i.itemId,
        tierKey: i.tierKey,
      })),
    });
    setIsDirty(false);
    return savedData;
  }, [annictWorkId, save]);

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
      const { shareToken } = await share.mutateAsync(annictWorkId);
      const url = buildCharacterTierListShareUrl(shareToken, apiUrl);
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
  }, [annictWorkId, presentShareUrl, saveTierListData, share]);

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
            id: i.annictCharacterId,
            tierKey: i.tierKey,
            title: i.name,
            imageUrl: i.imageUrl,
          })),
        );
        // スナップショットの描画とキャラクター画像の読み込み（onReady）を待って
        // から撮る。タイムアウトを超えたら読み込み途中のまま撮る
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

  // 共有は「盤面を保存 → トークン発行」を行う。保存済みデータ・名簿の
  // 読み込み中（or 取得失敗）に実行すると、初期状態の盤面を上書き保存
  // してしまうため、データが確定するまで共有を開始させない。
  const shareDisabled =
    isSharing ||
    save.isPending ||
    isSavedLoading ||
    isSavedError ||
    isCharactersLoading ||
    isCharactersError;

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
        testID="character-tier-list-back"
      >
        <Text style={styles.backButtonText}>‹ 戻る</Text>
      </TouchableOpacity>
    </View>
  );

  if (!validWorkId) {
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>{backBar}</View>
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            対象の作品を特定できませんでした
          </Text>
        </View>
      </SafeAreaView>
    );
  }

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
    // キャラクター一覧の取得は Annict トークン必須。
    // 未連携では盤面自体が空になるため、連携誘導を最優先で出す。
    return (
      <SafeAreaView style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>{backBar}</View>
        <AnnictSoftGate
          description="キャラクター Tier 表の作成には Annict との連携が必要です。連携すると作品のキャラクターを並べ替えられます。"
          surface="character_tier_list"
          testID="character-tier-list-soft-gate"
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
          キャラクターを長押ししてドラッグすると tier を移動できます。tier
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
            testID="character-tier-list-share"
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
              (!isDirty || save.isPending || isSavedError) &&
                styles.saveButtonDisabled,
            ]}
            onPress={handleSave}
            disabled={!isDirty || save.isPending || isSavedError}
            accessibilityRole="button"
            accessibilityLabel="tier 表を保存"
            accessibilityState={{
              disabled: !isDirty || save.isPending || isSavedError,
            }}
            testID="character-tier-list-save"
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

      {isCharactersError ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            キャラクターを取得できませんでした
          </Text>
        </View>
      ) : isSavedError ? (
        // 保存済み表の取得失敗。空の盤面を出すと続く保存で既存配置を
        // 消してしまうため、ボードは描画しない
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            保存済みの tier 表を取得できませんでした
          </Text>
        </View>
      ) : isCharactersLoading || isSavedLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.textMuted} />
          <Text style={styles.centeredText}>キャラクターを集めています</Text>
        </View>
      ) : characters.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.centeredText}>
            この作品のキャラクターが見つかりませんでした
          </Text>
        </View>
      ) : (
        <TierBoard
          tiers={tiers}
          items={characters}
          assignment={assignment}
          onAssign={handleAssign}
          onRenameTier={handleRenameTier}
          labelsEditable={!isSharing}
          trayEmptyLabel="すべてのキャラクターを配置しました"
        />
      )}

      {/*
        画像共有用のスナップショット。画面外に置いて常時非表示にし、
        共有実行の瞬間だけ描画 → キャプチャ → 破棄する。
        中身は保存済みデータ（savedData.items）なので、共有リンク先と
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
