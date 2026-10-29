import { renderHook, waitFor } from "@testing-library/react-native";
import {
  configureObserve,
  useMarkScreenInteractive,
  wrapWithObserveRoot,
} from "@/lib/observe";

jest.mock("expo-observe", () => ({
  Observe: { configure: jest.fn() },
  ObserveRoot: { wrap: jest.fn((component: unknown) => component) },
  useObserve: jest.fn(),
}));

// メソッドシグネチャではなく jest.Mock として参照する
// （unbound-method 回避のためモック側の形でキャストする）
const mock = jest.requireMock("expo-observe") as {
  Observe: { configure: jest.Mock };
  ObserveRoot: { wrap: jest.Mock };
  useObserve: jest.Mock;
};

describe("configureObserve", () => {
  test("expo-router 連携を有効化し、OAuth コード・state・ユーザー ID を計測パラメータから除外する", () => {
    configureObserve();
    expect(mock.Observe.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        integrations: {
          "expo-router": { filteredParams: ["code", "state", "uid"] },
        },
      }),
    );
  });

  test("JS の未処理エラー収集は無効にする（Sentry と二重収集しない）", () => {
    configureObserve();
    expect(mock.Observe.configure).toHaveBeenCalledWith(
      expect.objectContaining({ errorHandlingEnabled: false }),
    );
  });

  test("environment は EXPO_PUBLIC_ENVIRONMENT を正規化して付ける", () => {
    process.env.EXPO_PUBLIC_ENVIRONMENT = "preview";
    configureObserve();
    expect(mock.Observe.configure).toHaveBeenCalledWith(
      expect.objectContaining({ environment: "preview" }),
    );
    delete process.env.EXPO_PUBLIC_ENVIRONMENT;
  });
});

describe("wrapWithObserveRoot", () => {
  test("ルートコンポーネントを ObserveRoot.wrap で包む（TTR の計測）", () => {
    const Component = () => null;
    wrapWithObserveRoot(Component);
    expect(mock.ObserveRoot.wrap).toHaveBeenCalledWith(Component);
  });
});

describe("useMarkScreenInteractive", () => {
  test("画面のマウント時に markInteractive を一度だけ呼ぶ", async () => {
    const markInteractive = jest.fn();
    mock.useObserve.mockReturnValue({ markInteractive });

    await renderHook(() => useMarkScreenInteractive());

    await waitFor(() => expect(markInteractive).toHaveBeenCalledTimes(1));
  });
});
