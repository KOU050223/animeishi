import { useCallback, useEffect, useRef, useState } from "react";
import { useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { parseQrPayload, type MiniMeishi } from "@/features/friends/qrParser";

type QrScanResult = {
  /** スキャンして抽出されたユーザー ID。 */
  userId: string;
  /**
   * 対面交換 QR にだけ載る短期トークン（issue #417）。
   * 共有 URL 由来の QR には無く、その場合は undefined。
   */
  qrToken?: string | undefined;
  /**
   * オフライン交換 QR にだけ載る長寿命トークン（issue #663）。
   * 表示側がオフラインで qt を取れなかった QR にだけ付く。
   */
  offlineToken?: string | undefined;
  /** ミニ名刺（`?mc=`）。オフラインでも相手の名前を出すための最小情報。 */
  miniMeishi?: MiniMeishi | undefined;
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
 * パース自体は {@link parseQrPayload} の純粋関数に委譲しているため、
 * このフックのロジックもテストしやすい構造になっている。
 */
export function useQrScanner(options: UseQrScannerOptions = {}): UseQrScanner {
  const { onScanned } = options;
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  // ref で保持することで handleBarcodeScanned の参照同一性を保ちつつ最新値を参照できる。
  // render 中に ref は書けないため、コミット後の effect で同期する。
  const onScannedRef = useRef(onScanned);
  useEffect(() => {
    onScannedRef.current = onScanned;
  });
  const scannedRef = useRef(false);

  // CameraView の onBarcodeScanned に渡す購読コールバックのため参照を固定する。
  const handleBarcodeScanned = useCallback((result: BarcodeScanningResult) => {
    // 既にスキャン済みなら無視（同一フレームで複数回発火するため）。
    if (scannedRef.current) return;

    const payload = parseQrPayload(result.data);
    // 不正な QR。状態を変えず再スキャンを許可する。
    if (!payload) return;

    scannedRef.current = true;
    setScanned(true);
    onScannedRef.current?.({ ...payload, raw: result.data });
  }, []);

  const reset = () => {
    scannedRef.current = false;
    setScanned(false);
  };

  return {
    permission,
    requestPermission,
    scanned,
    handleBarcodeScanned,
    reset,
  };
}
