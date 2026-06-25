import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useAuth } from "@clerk/clerk-expo";
import { useIsFocused } from "@react-navigation/native";
import { CameraView } from "expo-camera";
import QRCode from "react-native-qrcode-svg";
import { useQrScanner } from "@/lib/useQrScanner";
import { useAddFriend } from "@/lib/useFriends";
import { alert } from "@/lib/dialog";

type Mode = "generate" | "scan";

export default function QrScreen() {
  const [mode, setMode] = useState<Mode>("generate");

  return (
    <View className="flex-1 bg-white">
      {/* モード切替タブ */}
      <View className="flex-row px-4 pt-12 pb-2 gap-2">
        <ModeButton
          label="マイQR"
          active={mode === "generate"}
          onPress={() => setMode("generate")}
        />
        <ModeButton
          label="スキャン"
          active={mode === "scan"}
          onPress={() => setMode("scan")}
        />
      </View>

      {mode === "generate" ? <GenerateView /> : <ScanView />}
    </View>
  );
}

function GenerateView() {
  const { userId, isSignedIn } = useAuth();

  if (!isSignedIn || !userId) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-gray-400 text-center">
          QR コードを表示するにはサインインしてください
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center px-8">
      <View
        className="p-6 bg-white rounded-2xl border border-gray-100"
        style={styles.qrCard}
        testID="qr-code-container"
      >
        <QRCode value={userId} size={240} />
      </View>
      <Text className="text-gray-500 text-sm mt-6 text-center">
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
        <Text className="text-gray-400">カメラを準備しています...</Text>
      </View>
    );
  }

  // 権限が拒否されている
  if (!permission.granted) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <Text className="text-gray-600 text-center mb-4">
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
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  camera: {
    flex: 1,
  },
});

function ModeButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      className={`flex-1 items-center px-3 py-2 rounded-full border ${
        active ? "border-indigo-500 bg-indigo-50" : "border-gray-200 bg-white"
      }`}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      <Text
        className={`text-sm font-medium ${active ? "text-indigo-600" : "text-gray-500"}`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
