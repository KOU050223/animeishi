// Web 版のスキャン不可時フォールバック（issue #595）。カメラが使えない
// 理由の説明と、代替手段の案内・ひろば「みつける」への導線を確かめる。
// jest は iOS 解決のため "./ScanFallback" ではネイティブ版を読む。
// Web 版を直接 import して検証する。
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ScanFallback } from "./ScanFallback.web";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ScanFallback (Web)", () => {
  it("カメラが使えない理由と代替手段を案内する", async () => {
    await render(<ScanFallback reason="error" />);

    expect(
      screen.getByText("カメラで QR コードをスキャンできません"),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "この環境ではカメラを利用できません。カメラが接続されていないか、ブラウザがカメラへのアクセスを許可していない可能性があります",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("・ひろばの「みつける」で相手の公開名刺を探す"),
    ).toBeTruthy();
  });

  it("権限拒否時はブラウザの許可が無い旨を出し、再試行で onRetry を呼ぶ", async () => {
    const onRetry = jest.fn();
    await render(<ScanFallback reason="denied" onRetry={onRetry} />);

    expect(
      screen.getByText("ブラウザでカメラの使用が許可されていません"),
    ).toBeTruthy();

    await fireEvent.press(screen.getByTestId("scan-fallback-retry"));

    expect(onRetry).toHaveBeenCalled();
  });

  it("onRetry を渡さないときは再試行ボタンを出さない", async () => {
    await render(<ScanFallback reason="error" />);

    expect(screen.queryByTestId("scan-fallback-retry")).toBeNull();
  });

  it("「ひろばで名刺を探す」でひろばの「みつける」へ遷移する", async () => {
    await render(<ScanFallback reason="error" />);

    await fireEvent.press(screen.getByTestId("scan-fallback-hiroba"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(tabs)/hiroba",
      params: { section: "discover", target: "users" },
    });
  });
});
