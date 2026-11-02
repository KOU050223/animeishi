import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  type ViewInstance,
} from "react-native";
import { useAuth } from "@clerk/expo";
import { useIsFocused } from "expo-router";
import { CameraView } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import { useTranslation } from "react-i18next";
import { useQrScanner } from "@/lib/useQrScanner";
import { useAddFriend } from "@/lib/useFriends";
import { ExchangeSuccessOverlay } from "@/components/social/ExchangeSuccessOverlay";
import { buildProfileUrl } from "@/lib/profileUrl";
import { shareTierListUrl } from "@/lib/tierList/share";
import { saveQrImage } from "@/lib/qrImage";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { SegmentedControl } from "@/components/ui";

// 「コピーしました」表示を元に戻すまでの時間。
const COPIED_LABEL_MS = 2000;

type Mode = "generate" | "scan";

// QR・フレンドタブの「QR」セクション（旧 QR タブ）。
// セクション自体が非表示の間はアンマウントされるため、
// 計測・カメラはこのコンポーネントのマウント状態に追従する。
export function QrSection() {
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
            label: "マイQR",
            active: mode === "generate",
            onPress: () => setMode("generate"),
          },
          {
            label: "スキャン",
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
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSavingImage, setIsSavingImage] = useState(false);

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
          QR コードを表示するにはサインインしてください
        </Text>
      </View>
    );
  }

  const shareUrl = buildProfileUrl(userId) ?? userId;

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
    <View className="flex-1 items-center justify-center px-8">
      {/* QR コードは読み取り精度のため常に白いカードに描画する
          （周囲の quiet zone も白が前提）。dark でも白のままにする。 */}
      {/* collapsable={false} は Android の captureRef 対策（View が
          フラット化されると view-shot が失敗するため）。 */}
      <View
        ref={qrCardRef}
        collapsable={false}
        className="p-6 bg-white rounded-2xl border border-slate-100"
        style={styles.qrCard}
        testID="qr-code-container"
      >
        {/* OS 標準カメラでも開けるよう、生の userId ではなく Web 版プロフィール
            URL を埋め込む。アプリ内スキャナは URL / 生 userId の両方を受理する
            （qrParser の後方互換）。 */}
        <QRCode value={shareUrl} size={240} />
      </View>
      <Text className="text-slate-500 dark:text-slate-400 text-sm mt-6 text-center">
        この QR コードを相手に読み取ってもらうと{"\n"}名刺を交換できます
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
    </View>
  );
}

function ScanView() {
  // 画面を離れたらカメラをアンマウントしてリソースを解放する。
  const isFocused = useIsFocused();
  const addFriend = useAddFriend();
  // 交換が成立した相手。非 null の間は成立演出（issue #414）を表示する。
  const [exchangeUid, setExchangeUid] = useState<string | null>(null);
  const {
    permission,
    requestPermission,
    scanned,
    handleBarcodeScanned,
    reset,
  } = useQrScanner({
    onScanned: ({ userId }) => {
      // スキャンした相手をフレンドに追加する。
      addFriend.mutate(userId, {
        onSuccess: () => {
          setExchangeUid(userId);
        },
        onError: (e) => {
          alert(
            "追加できませんでした",
            e instanceof Error ? e.message : "フレンド追加に失敗しました",
            { okLabel: "OK", onClose: reset },
          );
        },
      });
    },
  });

  const closeExchangeOverlay = () => {
    setExchangeUid(null);
    reset();
  };

  // 権限未確認
  if (!permission) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-slate-400 dark:text-slate-500">
          カメラを準備しています...
        </Text>
      </View>
    );
  }

  // 権限が拒否されている
  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-slate-600 dark:text-slate-300 text-center mb-4">
          QR コードをスキャンするにはカメラの許可が必要です
        </Text>
        <TouchableOpacity
          className="bg-indigo-600 rounded-lg px-6 py-3"
          onPress={requestPermission}
          accessibilityRole="button"
          accessibilityLabel="カメラの使用を許可"
        >
          <Text className="text-white font-semibold">カメラを許可</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View className="flex-1">
      {isFocused ? (
        <CameraView
          style={styles.camera}
          facing="back"
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
            ? "フレンド登録中..."
            : scanned
              ? "読み取り完了"
              : "QR コードを枠内に収めてください"}
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
  qrCard: {
    boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.08)",
  },
  camera: {
    flex: 1,
  },
});
