import { renderHook, act } from "@testing-library/react-native";
import type { BarcodeScanningResult } from "expo-camera";
import { useQrScanner } from "@/lib/useQrScanner";

// expo-camera のネイティブ依存を排し、権限フックだけをモックする。
jest.mock("expo-camera", () => ({
  useCameraPermissions: () => [
    { granted: true, canAskAgain: true, expires: "never", status: "granted" },
    jest.fn(),
  ],
}));

// BarcodeScanningResult の最小スタブ（data 以外はテストで未使用）。
function scan(data: string): BarcodeScanningResult {
  return {
    data,
    type: "qr",
    bounds: { origin: { x: 0, y: 0 }, size: { width: 0, height: 0 } },
    cornerPoints: [],
  } as unknown as BarcodeScanningResult;
}

const CLERK_ID = "user_2abcDEF1234567890ghijKLMN";

describe("useQrScanner", () => {
  it("有効な QR をスキャンすると onScanned が userId 付きで呼ばれる", () => {
    const onScanned = jest.fn();
    const { result } = renderHook(() => useQrScanner({ onScanned }));

    act(() => result.current.handleBarcodeScanned(scan(CLERK_ID)));

    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(onScanned).toHaveBeenCalledWith({ userId: CLERK_ID, raw: CLERK_ID });
    expect(result.current.scanned).toBe(true);
  });

  it("旧 URL 形式の QR からも userId を抽出する", () => {
    const onScanned = jest.fn();
    const { result } = renderHook(() => useQrScanner({ onScanned }));

    const raw = `https://animeishi-viewer.web.app/user/${CLERK_ID}`;
    act(() => result.current.handleBarcodeScanned(scan(raw)));

    expect(onScanned).toHaveBeenCalledWith({ userId: CLERK_ID, raw });
  });

  it("スキャン成功後は多重発火しない", () => {
    const onScanned = jest.fn();
    const { result } = renderHook(() => useQrScanner({ onScanned }));

    act(() => result.current.handleBarcodeScanned(scan(CLERK_ID)));
    act(() => result.current.handleBarcodeScanned(scan(CLERK_ID)));
    act(() => result.current.handleBarcodeScanned(scan(CLERK_ID)));

    expect(onScanned).toHaveBeenCalledTimes(1);
  });

  it("不正な QR では onScanned を呼ばず再スキャンを許可する", () => {
    const onScanned = jest.fn();
    const { result } = renderHook(() => useQrScanner({ onScanned }));

    act(() => result.current.handleBarcodeScanned(scan("not a valid qr")));

    expect(onScanned).not.toHaveBeenCalled();
    expect(result.current.scanned).toBe(false);

    // その後に有効な QR を読めば成功する。
    act(() => result.current.handleBarcodeScanned(scan(CLERK_ID)));
    expect(onScanned).toHaveBeenCalledTimes(1);
  });

  it("reset でスキャン状態が解除され再スキャンできる", () => {
    const onScanned = jest.fn();
    const { result } = renderHook(() => useQrScanner({ onScanned }));

    act(() => result.current.handleBarcodeScanned(scan(CLERK_ID)));
    expect(result.current.scanned).toBe(true);

    act(() => result.current.reset());
    expect(result.current.scanned).toBe(false);

    act(() => result.current.handleBarcodeScanned(scan(CLERK_ID)));
    expect(onScanned).toHaveBeenCalledTimes(2);
  });

  it("カメラ権限が granted として公開される", () => {
    const { result } = renderHook(() => useQrScanner());
    expect(result.current.permission?.granted).toBe(true);
  });
});
