import { useCallback, useRef, useState } from "react";
import { useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { parseUserIdFromQr } from "@/lib/qrParser";

export type QrScanResult = {
  /** スキャンして抽出されたユーザー ID。 */
  userId: string;
  /** スキャンした生データ（デバッグ・表示用）。 */
  raw: string;
};

export type UseQrScannerOptions = {
  /** ユーザー ID の抽出に成功したときに 1 度だけ呼ばれる。 */
  onScanned?: (result: QrScanResult) => void;
};

export type UseQrScanner = {
  /** カメラ権限の状態（null = 未確認）。 */
  permission: ReturnType<typeof useCameraPermissions>[0];
  /** カメラ権限をリクエストする。 */
  requestPermission: ReturnType<typeof useCameraPermissions>[1];
  /** 現在スキャンを受け付けているか（多重スキャン防止）。 */
  scanned: boolean;
  /** CameraView の onBarcodeScanned に渡すハンドラ。 */
  handleBarcodeScanned: (result: BarcodeScanningResult) => void;
  /** スキャン状態をリセットして再スキャンを許可する。 */
  reset: () => void;
};

/**
 * QR スキャンのロジックを担うフック。
 *
 * - 多重スキャン防止（成功するまで連続発火させない）
 * - パース失敗時は再スキャンを許可（不正な QR で固まらない）
 * - カメラ権限の状態を呼び出し側に公開
 *
 * パース自体は {@link parseUserIdFromQr} の純粋関数に委譲しているため、
 * このフックのロジックもテストしやすい構造になっている。
 */
export function useQrScanner(options: UseQrScannerOptions = {}): UseQrScanner {
  const { onScanned } = options;
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  // ref で保持することで handleBarcodeScanned の参照同一性を保ちつつ最新値を参照できる。
  const onScannedRef = useRef(onScanned);
  onScannedRef.current = onScanned;
  const scannedRef = useRef(false);

  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    // 既にスキャン済みなら無視（同一フレームで複数回発火するため）。
    if (scannedRef.current) return;

    const userId = parseUserIdFromQr(result.data);
    // 不正な QR。状態を変えず再スキャンを許可する。
    if (!userId) return;

    scannedRef.current = true;
    setScanned(true);
    onScannedRef.current?.({ userId, raw: result.data });
  }, []);

  const reset = useCallback(() => {
    scannedRef.current = false;
    setScanned(false);
  }, []);

  return {
    permission,
    requestPermission,
    scanned,
    handleBarcodeScanned,
    reset,
  };
}
