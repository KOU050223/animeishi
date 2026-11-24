import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  FlatList,
  StyleSheet,
  type ViewInstance,
} from "react-native";
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { CameraView } from "expo-camera";
import Ionicons from "@expo/vector-icons/Ionicons";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQrScanner } from "@/lib/useQrScanner";
import { useAddFriend } from "@/lib/useFriends";
import { useExchangeQrValue } from "@/lib/useExchangeQrValue";
import { nearbyExchange } from "@/lib/nearbyExchange";
import { NearbyExchangeView } from "@/components/social/nearby/NearbyExchangeView";
import { ApiRequestError } from "@/lib/apiError";
import { enqueueExchange } from "@/lib/exchangeQueue";
import {
  ExchangeResultLayer,
  type ExchangeResult,
} from "@/components/social/ExchangeResultLayer";
import { ScanFallback } from "@/components/social/ScanFallback";
import { MeishiCard } from "@/components/MeishiCard";
import { MeishiSnapshotImage } from "@/components/meishi/MeishiSnapshotImage";
import { buildProfileUrl } from "@/lib/profileUrl";
import { publicProfileQueries } from "@/lib/queries/publicProfile";
import { shareTierListUrl } from "@/lib/tierList/share";
import { saveQrImage } from "@/lib/qrImage";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { useProfile } from "@/lib/useProfile";
import { useMeishiLibrary } from "@/lib/meishi/useMeishiLibrary";
import { SegmentedControl } from "@/components/ui";

// 「コピーしました」表示を元に戻すまでの時間。
const COPIED_LABEL_MS = 2000;

type Mode = "nearby" | "generate" | "scan";

// QR・フレンドタブの「QR」セクション（旧 QR タブ）。
// セクション自体が非表示の間はアンマウントされるため、
// 計測・カメラはこのコンポーネントのマウント状態に追従する。
export function QrSection() {
  const { t } = useTranslation();
  // 近づけて交換（issue #693）を組み込んだビルドでは「近づける」を既定にし、
  // QR は予備に回す。UWB 非対応の iPhone でも近くの人をタップして交換できる
  // ため既定は変えない。実装の無いビルド（Android・Web・Expo Go）では
  // セグメント自体を出さない。
  const [mode, setMode] = useState<Mode>(() =>
    nearbyExchange.platformAvailable ? "nearby" : "generate",
  );
  const isFocused = useIsFocused();

  // 名刺交換（QR）画面への進入を計測する（issue #214）。タブの再訪でも
  // 発火させるためマウントではなくフォーカスを見る。
  // 遷移直後はルートレイアウト側の画面同期がまだ前画面のままなので、
  // screen は発火側で明示する（issue #214 の screen は所属画面を指す）。
  useEffect(() => {
    if (isFocused) {
      trackEvent("qr_exchange_start", undefined, { screen: "social" });
    }
  }, [isFocused]);

  // スキャン開始。タブ切替（onPress による mode 遷移）と、スキャン状態の
  // ままタブを離れて再訪した場合の両方を isFocused && mode で捉える。
  // モードが "scan" に変わった時だけ発火するので、スキャン中の再タップや
  // generate への遷移では送らない。
  useEffect(() => {
    if (isFocused && mode === "scan") {
      trackEvent("qr_scan_start", undefined, { screen: "social" });
    }
  }, [isFocused, mode]);

  return (
    <View className="flex-1 bg-white dark:bg-slate-900">
      <SegmentedControl
        items={[
          ...(nearbyExchange.platformAvailable
            ? [
                {
                  label: t("近づける"),
                  active: mode === "nearby",
                  onPress: () => setMode("nearby"),
                  testID: "qr-mode-nearby",
                },
              ]
            : []),
          {
            label: t("マイQR"),
            active: mode === "generate",
            onPress: () => setMode("generate"),
          },
          {
            label: t("スキャン"),
            active: mode === "scan",
            onPress: () => setMode("scan"),
          },
        ]}
      />

      {mode === "nearby" ? (
        <NearbyExchangeView onShowQr={() => setMode("generate")} />
      ) : mode === "generate" ? (
        <GenerateView />
      ) : (
        <ScanView onShowMyQr={() => setMode("generate")} />
      )}
    </View>
  );
}

function GenerateView() {
  const { userId, isSignedIn } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // セクションは非表示の間アンマウントされるが、所属タブへの再訪でも
  // 発火させるためフォーカスも見る。
  const isFocused = useIsFocused();
  const { t } = useTranslation();
  // 画像で保存のキャプチャ対象（画面外に描画したトークン無しの QR カード）。
  const qrSaveCardRef = useRef<ViewInstance>(null);
  // 対面で見せる QR の値（qt / ot / ミニ名刺付き）。近づけて交換で相手へ
  // 送るデータと同じものを使う（issue #693）。
  const { qrValue } = useExchangeQrValue();
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const { data: profile } = useProfile();
  // 渡す名刺（issue #595）。外に出る名刺は常に既定の 1 枚（issue #427）
  // だが、対面で画面に見せる名刺は端末内の一覧から選べる。選択は
  // この画面の表示だけに効き、既定の切り替えは名刺一覧側の操作に残す。
  const {
    cards: meishiCards,
    defaultCard: meishiDefaultCard,
    reload: reloadMeishi,
  } = useMeishiLibrary();
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // 既定の名刺の公開スナップショット URL（issue #593）。相手が受け取るのと
  // 同じ画像を出すため、公開プロフィールの meishiSnapshotUrl をそのまま使う。
  // 非公開プロフィールは 404 になるが、配信側も非公開なら 404 なので
  // どのみち画像は取れず、端末内レンダリングにフォールバックする。
  const { data: ownPublicProfile, refetch: refetchOwnPublicProfile } = useQuery(
    {
      ...publicProfileQueries.detail.query({
        uid: userId ?? "",
        viewerId: userId,
      }),
      enabled: !!isSignedIn && !!userId,
    },
  );

  // 名刺エディタで内容が変わっていることがあるため、フォーカスのたびに
  // ライブラリを読み直す（プロフィール画面と同じ作法）。
  // 公開プロフィールも取り直す。名刺を編集するとスナップショットが
  // 再生成されて ?v= の版が変わるので、編集直後に古い画像が残らない
  // ようにする。
  // useFocusEffect はコールバックの参照変化で購読し直すため、useCallback を残す。
  useFocusEffect(
    useCallback(() => {
      void reloadMeishi();
      if (isSignedIn && userId) {
        void refetchOwnPublicProfile();
      }
    }, [reloadMeishi, refetchOwnPublicProfile, isSignedIn, userId]),
  );

  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    },
    [],
  );

  // マイ QR の表示 = 名刺の共有面。サインイン済みで QR が実際に出た時だけ
  // 計測する（issue #214）。
  useEffect(() => {
    if (isFocused && isSignedIn && userId) {
      trackEvent("meishi_share", undefined, { screen: "social" });
    }
  }, [isFocused, isSignedIn, userId]);

  function showCopied() {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    setCopied(true);
    copiedTimerRef.current = setTimeout(
      () => setCopied(false),
      COPIED_LABEL_MS,
    );
  }

  if (!isSignedIn || !userId) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-muted text-center">
          {t("QR コードを表示するにはサインインしてください")}
        </Text>
      </View>
    );
  }

  const shareUrl = buildProfileUrl(userId) ?? userId;
  // 表示する名刺。選択中のカードが削除・切替済みなら既定の名刺に戻る
  // （さらにライブラリが空なら MeishiCard 側の classic テンプレに落ちる）。
  const displayCard =
    meishiCards.find((card) => card.id === selectedCardId) ?? meishiDefaultCard;
  // 公開スナップショットは既定の名刺の分だけが存在する（issue #593）。
  // 選択中の名刺が既定なら相手が受け取るのと同じ画像を表示し、
  // 既定以外やスナップショット未作成のときは端末内レンダリングに留める。
  const snapshotUrl =
    displayCard != null && displayCard.id === meishiDefaultCard?.id
      ? (ownPublicProfile?.meishiSnapshotUrl ?? null)
      : null;
  const meishiCardElement = (
    <MeishiCard
      username={profile?.username}
      bio={profile?.bio}
      favoriteQuote={profile?.favoriteQuote}
      profileImageUrl={profile?.profileImageUrl}
      profileUrl={shareUrl}
      document={displayCard?.document ?? null}
    />
  );

  async function onShareLink() {
    try {
      // native は OS 共有シート、web は Web Share API → クリップボードの順に
      // フォールバックする（lib/tierList/share の ShareTierListUrl）。
      const result = await shareTierListUrl(shareUrl);
      if (result === "copied") {
        showCopied();
      } else if (result === "blocked") {
        // 自動で渡せなかった（Web のユーザー操作期限切れ等）。
        // URL 自体を見せて手動コピーしてもらう。
        alert(t("共有できませんでした"), shareUrl, { okLabel: "OK" });
      }
    } catch {
      alert(t("共有できませんでした"), t("時間をおいて再度お試しください。"), {
        okLabel: "OK",
      });
    }
  }

  async function onCopyLink() {
    try {
      await Clipboard.setStringAsync(shareUrl);
      showCopied();
    } catch {
      alert(t("コピーできませんでした"), shareUrl, { okLabel: "OK" });
    }
  }

  async function onSaveImage() {
    setIsSavingImage(true);
    try {
      // QR カードの白背景に合わせて PNG の下地も白にする（web のみで使う）。
      // 撮るのは画面外の qrSaveCardRef 側。表示中の QR には qt/ot が載って
      // おり、保存画像に残すと画像経由で誰でも期限内にフレンドを成立
      // できてしまうため、トークン無しの URL を撮る（issue #680 レビュー）。
      await saveQrImage(qrSaveCardRef, {
        title: t("マイ QR"),
        backgroundColor: "#ffffff",
      });
    } catch {
      alert(
        t("画像の保存に失敗しました"),
        t("時間をおいて再度お試しください。"),
        { okLabel: "OK" },
      );
    }
    setIsSavingImage(false);
  }

  return (
    // カード＋共有ボタンはコンテナをはみ出すことがある（低いウィンドウや
    // ブラウザズーム時）。justify-center のままだと上下両方向に溢れて
    // セグメント切り替えに被さるため、収まるときは中央・収まらないときは
    // スクロールする ScrollView にする（issue #527）。
    <ScrollView
      className="flex-1"
      // 下端はネイティブのタブバーに潜り込むため、収まらずスクロールした
      // 最後の要素がその下に隠れないようタブバー分の inset を余白へ足す
      // （issue #462）。
      contentInsetAdjustmentBehavior="never"
      contentContainerStyle={{
        flexGrow: 1,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 32,
        paddingTop: 16,
        paddingBottom: 16 + insets.bottom,
      }}
      testID="qr-generate-scroll"
    >
      {/* 渡す名刺を QR の主役として出す（issue #595）。document の解決は
          プロフィールの名刺プレビューと同じく、端末内ライブラリの
          カードをプロフィール情報で描画する。既定の名刺では公開
          スナップショット画像を出し、読み込み中・失敗・未作成では
          端末内レンダリングにフォールバックする。 */}
      <View
        className="w-full"
        style={styles.meishiCard}
        testID="qr-meishi-card"
      >
        {/* uri が null（既定以外・スナップショット未作成）なら中で
            fallback に落ちる。?v= で URL が変わると内部状態が
            リセットされるため key は不要。 */}
        <MeishiSnapshotImage
          uri={snapshotUrl}
          fallback={meishiCardElement}
          accessibilityLabel={t("渡す名刺")}
          keepFallbackForA11y
          testID="meishi-snapshot"
        />
      </View>
      {/* スクリーンショットでも誰の QR か分かるよう名を添える
          （issue #595）。 */}
      <Text
        className="mt-2 text-base font-semibold text-slate-900 dark:text-slate-100"
        testID="qr-owner-username"
      >
        {profile?.username ?? userId}
      </Text>
      {/* 複数の名刺があるときは渡す 1 枚を選べる（issue #427 連携）。 */}
      {meishiCards.length > 1 ? (
        <View className="mt-3 self-stretch" testID="qr-meishi-picker">
          <Text className="mb-1.5 text-xs text-slate-500 dark:text-slate-400">
            {t("渡す名刺")}
          </Text>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerClassName="gap-2"
            data={meishiCards}
            keyExtractor={(card) => card.id}
            renderItem={({ item: card }) => {
              const active = card.id === displayCard?.id;
              return (
                <TouchableOpacity
                  className={`rounded-full border px-3 py-1.5 ${
                    active
                      ? "border-indigo-600 bg-indigo-600"
                      : "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
                  }`}
                  onPress={() => setSelectedCardId(card.id)}
                  accessibilityRole="button"
                  accessibilityLabel={t("{{name}}を渡す名刺にする", {
                    name: card.name,
                  })}
                  accessibilityState={{ selected: active }}
                  testID={`qr-meishi-pick-${card.id}`}
                >
                  <Text
                    className={`text-xs font-medium ${
                      active
                        ? "text-white"
                        : "text-slate-600 dark:text-slate-300"
                    }`}
                  >
                    {card.name}
                    {card.id === meishiDefaultCard?.id
                      ? `（${t("既定")}）`
                      : ""}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        </View>
      ) : null}
      {/* QR コードは読み取り精度のため常に白いカードに描画する
          （周囲の quiet zone も白が前提）。dark でも白のままにする。 */}
      <View
        className="mt-6 p-6 bg-white rounded-2xl border border-slate-100"
        style={styles.qrCard}
        testID="qr-code-container"
      >
        {/* OS 標準カメラでも開けるよう、生の userId ではなく Web 版プロフィール
            URL を埋め込む。アプリ内スキャナは URL / 生 userId の両方を受理する
            （qrParser の後方互換）。対面交換トークンは ?qt= で付ける。 */}
        <QRCode value={qrValue ?? shareUrl} size={240} />
      </View>
      {/* 非公開プロフィールの QR は /user/:uid が 404 になり、
          アプリを持っていない相手は名刺を見られない（issue #676）。
          渡す側が気づけるよう、QR の隣に警告と公開設定への導線を出す。
          取得中（undefined）は出さず、isPublic === false が確定した
          ときだけ表示する。 */}
      {profile?.isPublic === false ? (
        <View
          className="mt-4 flex-row items-center self-stretch rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950"
          accessibilityRole="alert"
          testID="qr-private-warning"
        >
          <Ionicons name="warning-outline" size={16} color="#d97706" />
          <Text className="ml-2 flex-1 text-xs text-amber-800 dark:text-amber-200">
            {t(
              "プロフィールが非公開のため、アプリを持っていない相手には名刺が表示されません",
            )}
          </Text>
          <TouchableOpacity
            className="ml-2 rounded-md border border-amber-300 bg-white px-2.5 py-1.5 dark:border-amber-700 dark:bg-amber-900"
            onPress={() => router.push("/(tabs)/profile")}
            accessibilityRole="button"
            accessibilityLabel={t("公開設定を開く")}
            testID="qr-private-warning-open-settings"
          >
            <Text className="text-xs font-medium text-amber-700 dark:text-amber-300">
              {t("公開設定を開く")}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Text className="text-slate-500 dark:text-slate-400 text-sm mt-6 text-center">
        {t("この QR コードを相手に読み取ってもらうと")}
        {"\n"}
        {t("名刺を交換できます")}
      </Text>
      {/* 離れた相手とも名刺交換できるよう、リンク・画像での共有導線を置く
          （issue #413）。 */}
      <View className="flex-row gap-2 mt-4 self-stretch">
        <TouchableOpacity
          className="flex-1 bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg py-2 items-center"
          onPress={() => void onShareLink()}
          accessibilityRole="button"
          accessibilityLabel={t("リンクを共有")}
          testID="qr-share-link"
        >
          <Text className="text-xs text-indigo-600 dark:text-indigo-300 font-medium">
            {t("リンクを共有")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg py-2 items-center"
          onPress={() => void onCopyLink()}
          accessibilityRole="button"
          accessibilityLabel={t("リンクをコピー")}
          testID="qr-copy-link"
        >
          <Text className="text-xs text-indigo-600 dark:text-indigo-300 font-medium">
            {copied ? t("コピーしました") : t("リンクをコピー")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          className="flex-1 bg-indigo-50 dark:bg-indigo-950 border border-indigo-200 dark:border-indigo-800 rounded-lg py-2 items-center"
          onPress={() => void onSaveImage()}
          disabled={isSavingImage}
          accessibilityRole="button"
          accessibilityLabel={t("画像で保存")}
          testID="qr-save-image"
        >
          <Text className="text-xs text-indigo-600 dark:text-indigo-300 font-medium">
            {isSavingImage ? t("保存中...") : t("画像で保存")}
          </Text>
        </TouchableOpacity>
      </View>
      {/* 「画像で保存」で撮る用のトークン無し QR カード。表示中の QR には
          qt/ot が載るため、画像に残らないようトークン無しの URL を別に
          描画しておく。display: none だと captureRef / html-to-image で
          撮れないため、画面外へ飛ばす。 */}
      <View
        ref={qrSaveCardRef}
        collapsable={false}
        accessible={false}
        className="p-6 bg-white rounded-2xl border border-slate-100"
        style={[styles.offscreenCard, styles.qrCard]}
        testID="qr-save-card"
      >
        <QRCode value={shareUrl} size={240} testID="qr-code-save" />
      </View>
    </ScrollView>
  );
}

function ScanView({ onShowMyQr }: { onShowMyQr: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // 画面を離れたらカメラをアンマウントしてリソースを解放する。
  const isFocused = useIsFocused();
  const router = useRouter();
  const addFriend = useAddFriend();
  // 交換の結果。非 null の間は成立演出（issue #414）か、オフラインで
  // キューへ積んだ受付画面（issue #681）と、その後のシートを出す。
  const [exchangeResult, setExchangeResult] = useState<ExchangeResult | null>(
    null,
  );
  // カメラの起動失敗（権限は通ったが映像が取れない。Web でカメラ無し・
  // ブラウザ非対応のときに起きる）。失敗後は再マウントできるよう
  // カメラの key を持つ。
  const [mountError, setMountError] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);

  const {
    permission,
    requestPermission,
    scanned,
    handleBarcodeScanned,
    reset,
  } = useQrScanner({
    onScanned: ({ userId, qrToken, offlineToken, miniMeishi }) => {
      if (!qrToken && !offlineToken) {
        openProfile(userId);
        return;
      }
      // 対面交換トークン付き = 相手が目の前で QR を提示した場合だけ即時成立。
      // 相手がオフラインだった QR には qt の代わりに ot が載る（issue #663）。
      addFriend.mutate(
        { friendId: userId, qrToken, offlineToken },
        {
          onSuccess: (result) => {
            setExchangeResult({
              kind: "success",
              uid: userId,
              meetingCount: result.meetingCount,
              recordId: result.recordId,
            });
          },
          onError: (e) => {
            if (!(e instanceof ApiRequestError)) {
              // HTTP 応答が無い失敗 = ネットワークに届かない（オフライン等）。
              // 交換キューへ積んで受付画面を出し、通信復帰後の flush で
              // 成立させる（issue #681）。キュー保存自体に失敗したときだけ
              // 失敗の alert に落ちる。
              void enqueueExchange({
                friendId: userId,
                qrToken,
                offlineToken,
                miniMeishi,
              })
                .then(() => {
                  setExchangeResult({
                    kind: "queued",
                    uid: userId,
                    miniMeishi,
                  });
                })
                .catch(() => {
                  alert(
                    t("追加できませんでした"),
                    t("フレンド追加に失敗しました"),
                    { okLabel: "OK", onClose: reset },
                  );
                });
              return;
            }
            if (e.code === "qr_exchange_required") {
              // 期限切れ・無効なトークンは申請フローに誘導する。
              alert(
                t("QR の有効期限が切れています"),
                t("プロフィール画面からフレンド申請を送れます"),
                { okLabel: "OK", onClose: () => openProfile(userId) },
              );
              return;
            }
            alert(t("追加できませんでした"), t("フレンド追加に失敗しました"), {
              okLabel: "OK",
              onClose: reset,
            });
          },
        },
      );
    },
  });

  // 共有 URL・名刺画像などトークンを持たない QR は「共有 URL」扱いで
  // 申請フローに誘導する（issue #417）。プロフィール画面に申請ボタンがある。
  // スキャン済みフラグを戻してから遷移し、戻ってきたとき再スキャンできる
  // ようにする。
  function openProfile(userId: string) {
    reset();
    router.push({ pathname: "/user/[uid]", params: { uid: userId } });
  }

  const closeExchangeResult = () => {
    setExchangeResult(null);
    reset();
  };

  // 権限未確認
  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-muted">{t("カメラを準備しています...")}</Text>
      </View>
    );
  }

  // 権限が拒否されている / カメラを起動できない。フォールバックの
  // 内容はプラットフォームで分岐する（ScanFallback、issue #595）。
  if (!permission.granted) {
    return <ScanFallback reason="denied" onRetry={requestPermission} />;
  }
  if (mountError) {
    return (
      <ScanFallback
        reason="error"
        onRetry={() => {
          setMountError(false);
          setCameraKey((k) => k + 1);
        }}
      />
    );
  }

  return (
    <View className="flex-1">
      {isFocused ? (
        <CameraView
          key={cameraKey}
          style={styles.camera}
          facing="back"
          onMountError={() => setMountError(true)}
          // スキャン済みのときはハンドラを外して発火を止める。
          onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          testID="qr-camera-view"
        />
      ) : (
        // フォーカスが外れている間はカメラを描画しない（メモリ解放）。
        <View className="flex-1 bg-black" />
      )}
      {/* bottom-12 (48px) はタブバー＋ホームインジケータ (~83px) より浅く、
          ヒントがその下に隠れるためタブバー分の inset を足す（issue #462）。 */}
      <View
        className="absolute left-0 right-0 items-center"
        style={{ bottom: insets.bottom + 16 }}
      >
        <Text className="text-white text-sm bg-black/50 px-4 py-2 rounded-full">
          {addFriend.isPending
            ? t("フレンド登録中...")
            : scanned
              ? t("読み取り完了")
              : t("QR コードを枠内に収めてください")}
        </Text>
      </View>
      {exchangeResult ? (
        // マイ QR への切り替えでこのビューごとアンマウントされるため、
        // オーバーレイやスキャンの状態を戻す処理は要らない（issue #682）。
        // シートの裏で QR の再検出・再交換が走らないよう、スキャナの
        // 再開（reset）はすべて閉じるまで待つ。
        <ExchangeResultLayer
          key={`${exchangeResult.kind}-${exchangeResult.uid}`}
          result={exchangeResult}
          onDone={closeExchangeResult}
          onShowMyQr={onShowMyQr}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // 名刺を主役として出しつつ、横幅のある Web でカードが
  // 伸びすぎないよう上限を設ける。
  meishiCard: {
    maxWidth: 440,
  },
  qrCard: {
    boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.08)",
  },
  // 「画像で保存」のキャプチャ対象を画面外へ飛ばす（display: none では
  // view-shot / html-to-image で撮れないため）。
  offscreenCard: {
    position: "absolute",
    top: -10000,
    left: -10000,
  },
  camera: {
    flex: 1,
  },
});
