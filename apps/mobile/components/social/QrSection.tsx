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
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { CameraView } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useQrScanner } from "@/lib/useQrScanner";
import { useAddFriend, useQrExchangeToken } from "@/lib/useFriends";
import { ApiRequestError } from "@/lib/apiError";
import { ExchangeSuccessOverlay } from "@/components/social/ExchangeSuccessOverlay";
import { ScanFallback } from "@/components/social/ScanFallback";
import { MeishiCard } from "@/components/MeishiCard";
import { buildProfileUrl } from "@/lib/profileUrl";
import { shareTierListUrl } from "@/lib/tierList/share";
import { saveQrImage } from "@/lib/qrImage";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { useProfile } from "@/lib/useProfile";
import { useMeishiLibrary } from "@/lib/meishi/useMeishiLibrary";
import { SegmentedControl } from "@/components/ui";

// 「コピーしました」表示を元に戻すまでの時間。
const COPIED_LABEL_MS = 2000;

type Mode = "generate" | "scan";

// QR・フレンドタブの「QR」セクション（旧 QR タブ）。
// セクション自体が非表示の間はアンマウントされるため、
// 計測・カメラはこのコンポーネントのマウント状態に追従する。
export function QrSection() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("generate");
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

      {mode === "generate" ? <GenerateView /> : <ScanView />}
    </View>
  );
}

function GenerateView() {
  const { userId, isSignedIn } = useAuth();
  // セクションは非表示の間アンマウントされるが、所属タブへの再訪でも
  // 発火させるためフォーカスも見る。
  const isFocused = useIsFocused();
  const { t } = useTranslation();
  // 画像で保存のキャプチャ対象（QR カード View）。
  const qrCardRef = useRef<ViewInstance>(null);
  // 対面交換 QR に埋め込む短期トークン。トークン無しの QR を提示しても
  // 読み取り側は即時成立できず申請画面に送られるだけなので、取得失敗時も
  // トークン無しのまま表示してよい（issue #417）。
  const qrToken = useQrExchangeToken();
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

  // 名刺エディタで内容が変わっていることがあるため、フォーカスのたびに
  // ライブラリを読み直す（プロフィール画面と同じ作法）。
  useFocusEffect(
    useCallback(() => {
      void reloadMeishi();
    }, [reloadMeishi]),
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
        <Text className="text-slate-400 dark:text-slate-500 text-center">
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
  // 対面の読み合いだけ即時成立にするため、表示する QR には本人紐づきの
  // 短期トークンを載せる（issue #417）。リンク・画像共有にはトークンを
  // 載せない shareUrl を使い回し、遠隔では申請フローに限定する。
  const qrValue = qrToken.data?.token
    ? `${shareUrl}?qt=${encodeURIComponent(qrToken.data.token)}`
    : shareUrl;

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
      await saveQrImage(qrCardRef, {
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
      contentContainerClassName="flex-grow items-center justify-center px-8 py-4"
      testID="qr-generate-scroll"
    >
      {/* 渡す名刺を QR の主役として出す（issue #595）。document の解決は
          プロフィールの名刺プレビューと同じく、端末内ライブラリの
          カードをプロフィール情報で描画する。 */}
      <View
        className="w-full"
        style={styles.meishiCard}
        testID="qr-meishi-card"
      >
        <MeishiCard
          username={profile?.username}
          bio={profile?.bio}
          favoriteQuote={profile?.favoriteQuote}
          profileImageUrl={profile?.profileImageUrl}
          profileUrl={shareUrl}
          document={displayCard?.document ?? null}
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
      {/* collapsable={false} は Android の captureRef 対策（View が
          フラット化されると view-shot が失敗するため）。 */}
      <View
        ref={qrCardRef}
        collapsable={false}
        className="mt-6 p-6 bg-white rounded-2xl border border-slate-100"
        style={styles.qrCard}
        testID="qr-code-container"
      >
        {/* OS 標準カメラでも開けるよう、生の userId ではなく Web 版プロフィール
            URL を埋め込む。アプリ内スキャナは URL / 生 userId の両方を受理する
            （qrParser の後方互換）。対面交換トークンは ?qt= で付ける。 */}
        <QRCode value={qrValue} size={240} />
      </View>
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
    </ScrollView>
  );
}

function ScanView() {
  const { t } = useTranslation();
  // 画面を離れたらカメラをアンマウントしてリソースを解放する。
  const isFocused = useIsFocused();
  const router = useRouter();
  const addFriend = useAddFriend();
  // 交換が成立した相手。非 null の間は成立演出（issue #414）を表示する。
  const [exchangeUid, setExchangeUid] = useState<string | null>(null);
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
    onScanned: ({ userId, qrToken }) => {
      if (!qrToken) {
        openProfile(userId);
        return;
      }
      // 対面交換トークン付き = 相手が目の前で QR を提示した場合だけ即時成立。
      addFriend.mutate(
        { friendId: userId, qrToken },
        {
          onSuccess: () => {
            setExchangeUid(userId);
          },
          onError: (e) => {
            if (
              e instanceof ApiRequestError &&
              e.code === "qr_exchange_required"
            ) {
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

  const closeExchangeOverlay = () => {
    setExchangeUid(null);
    reset();
  };

  // 権限未確認
  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-slate-400 dark:text-slate-500">
          {t("カメラを準備しています...")}
        </Text>
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
      <View className="absolute bottom-12 left-0 right-0 items-center">
        <Text className="text-white text-sm bg-black/50 px-4 py-2 rounded-full">
          {addFriend.isPending
            ? t("フレンド登録中...")
            : scanned
              ? t("読み取り完了")
              : t("QR コードを枠内に収めてください")}
        </Text>
      </View>
      {exchangeUid ? (
        <ExchangeSuccessOverlay
          uid={exchangeUid}
          onClose={closeExchangeOverlay}
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
  camera: {
    flex: 1,
  },
});
