import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useAuth } from "@clerk/expo";
import { useIsFocused } from "expo-router";
import { CameraView } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import { useQrScanner } from "@/lib/useQrScanner";
import { useAddFriend } from "@/lib/useFriends";
import { buildProfileUrl } from "@/lib/profileUrl";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { SegmentedControl } from "@/components/ui";

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

  // マイ QR の表示 = 名刺の共有面。サインイン済みで QR が実際に出た時だけ
  // 計測する（issue #214）。
  useEffect(() => {
    if (isFocused && isSignedIn && userId) {
      trackEvent("meishi_share", undefined, { screen: "social" });
    }
  }, [isFocused, isSignedIn, userId]);

  if (!isSignedIn || !userId) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-slate-400 dark:text-slate-500 text-center">
          QR コードを表示するにはサインインしてください
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center px-8">
      {/* QR コードは読み取り精度のため常に白いカードに描画する
          （周囲の quiet zone も白が前提）。dark でも白のままにする。 */}
      <View
        className="p-6 bg-white rounded-2xl border border-slate-100"
        style={styles.qrCard}
        testID="qr-code-container"
      >
        {/* OS 標準カメラでも開けるよう、生の userId ではなく Web 版プロフィール
            URL を埋め込む。アプリ内スキャナは URL / 生 userId の両方を受理する
            （qrParser の後方互換）。 */}
        <QRCode value={buildProfileUrl(userId) ?? userId} size={240} />
      </View>
      <Text className="text-slate-500 dark:text-slate-400 text-sm mt-6 text-center">
        この QR コードを相手に読み取ってもらうと{"\n"}名刺を交換できます
      </Text>
    </View>
  );
}

function ScanView() {
  // 画面を離れたらカメラをアンマウントしてリソースを解放する。
  const isFocused = useIsFocused();
  const addFriend = useAddFriend();
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
          alert("フレンドに追加しました", "相手をフレンドに登録しました", {
            okLabel: "OK",
            onClose: reset,
          });
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
