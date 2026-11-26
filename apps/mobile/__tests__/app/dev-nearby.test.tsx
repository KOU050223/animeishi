import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import NearbySpikeScreen from "@/app/dev/nearby";
import { loggedInUser, resetAuth } from "@/test-utils/auth";

const mockStart = jest.fn();
const mockStop = jest.fn();
const mockImpactLight = jest.fn();
const mockImpactMedium = jest.fn();
const mockImpactHeavy = jest.fn();

type Listener = (payload: Record<string, unknown>) => void;
const mockListeners = new Map<string, Set<Listener>>();
const emitEvent = async (event: string, payload: Record<string, unknown>) => {
  await act(async () => {
    mockListeners.get(event)?.forEach((listener) => listener(payload));
  });
};

jest.mock("expo-router", () => ({
  // Stack.Screen の options を描画し、タイトルと戻るボタンを検証できるようにする。
  Stack: {
    Screen: ({ options }: { options?: { title?: string } }) => {
      const { Text } = require("react-native");
      return options?.title ? <Text>{options.title}</Text> : null;
    },
  },
  Redirect: ({ href }: { href: string }) => {
    const { Text } = require("react-native");
    return <Text>{`redirect:${href}`}</Text>;
  },
  useRouter: () => ({
    canGoBack: () => true,
    back: jest.fn(),
    replace: jest.fn(),
  }),
}));

jest.mock("@/features/me/useProfile", () => ({
  useProfile: () => ({ data: { username: "テスト太郎" } }),
}));

jest.mock("@/features/friends/nearbyExchange", () => ({
  // 純ロジック（閾値・ハプティクス状態機械）は本物を使う。
  ...jest.requireActual("@/features/friends/nearbyExchange/proximityLevel"),
  nearbyExchange: {
    start: (...args: unknown[]) => mockStart(...args),
    stop: () => mockStop(),
    addListener: (event: string, listener: Listener) => {
      let set = mockListeners.get(event);
      if (!set) {
        set = new Set();
        mockListeners.set(event, set);
      }
      set.add(listener);
      return { remove: () => set.delete(listener) };
    },
  },
}));

jest.mock("@/lib/haptics", () => ({
  haptics: {
    impactLight: () => mockImpactLight(),
    impactMedium: () => mockImpactMedium(),
    impactHeavy: () => mockImpactHeavy(),
    success: () => {},
    warning: () => {},
    selection: () => {},
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  resetAuth();
  loggedInUser();
  process.env.EXPO_PUBLIC_NEARBY_SPIKE = "true";
});

afterEach(() => {
  delete process.env.EXPO_PUBLIC_NEARBY_SPIKE;
});

describe("NearbySpikeScreen", () => {
  it("開くと start が呼ばれ、アンマウントで stop される", async () => {
    const { unmount } = await render(<NearbySpikeScreen />);
    expect(mockStart).toHaveBeenCalledWith({ displayName: "テスト太郎" });
    await unmount();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("見つかった相手が一覧され、距離が cm で表示される", async () => {
    await render(<NearbySpikeScreen />);
    await emitEvent("onPeerFound", {
      peerId: "peer-1",
      displayName: "テスト花子",
    });
    expect(screen.getByText("テスト花子")).toBeTruthy();

    await emitEvent("onDistance", { peerId: "peer-1", meters: 0.35 });
    expect(screen.getByText("35")).toBeTruthy();
    expect(screen.getByText("cm")).toBeTruthy();
  });

  it("50cm 帯では弱いハプティクス、20cm 帯では中程度が鳴る", async () => {
    await render(<NearbySpikeScreen />);
    await emitEvent("onPeerFound", { peerId: "peer-1", displayName: "相手" });
    await emitEvent("onDistance", { peerId: "peer-1", meters: 0.4 });
    expect(mockImpactLight).toHaveBeenCalledTimes(1);
    expect(mockImpactMedium).not.toHaveBeenCalled();

    await emitEvent("onDistance", { peerId: "peer-1", meters: 0.15 });
    expect(mockImpactMedium).toHaveBeenCalledTimes(1);
  });

  it("10cm 以下で成立バッジが出て、強いハプティクスが 1 回だけ鳴る", async () => {
    await render(<NearbySpikeScreen />);
    await emitEvent("onPeerFound", { peerId: "peer-1", displayName: "相手" });
    await emitEvent("onDistance", { peerId: "peer-1", meters: 0.08 });
    expect(screen.getByText("成立")).toBeTruthy();
    expect(mockImpactHeavy).toHaveBeenCalledTimes(1);

    // touch のまま更新が続いても 1 回だけ
    await emitEvent("onDistance", { peerId: "peer-1", meters: 0.09 });
    expect(mockImpactHeavy).toHaveBeenCalledTimes(1);

    // 一度離れてから近づき直すと再度鳴る
    await emitEvent("onDistance", { peerId: "peer-1", meters: 0.5 });
    await emitEvent("onDistance", { peerId: "peer-1", meters: 0.07 });
    expect(mockImpactHeavy).toHaveBeenCalledTimes(2);
  });

  it("onPeerLost で相手が一覧から消える", async () => {
    await render(<NearbySpikeScreen />);
    await emitEvent("onPeerFound", {
      peerId: "peer-1",
      displayName: "消える人",
    });
    expect(screen.getByText("消える人")).toBeTruthy();
    await emitEvent("onPeerLost", { peerId: "peer-1" });
    expect(screen.queryByText("消える人")).toBeNull();
  });

  it("UWB 非対応と unsupported_platform エラーが画面に出る", async () => {
    await render(<NearbySpikeScreen />);
    await emitEvent("onCapability", { uwb: false });
    await emitEvent("onError", { code: "unsupported_platform", message: "" });
    expect(screen.getByText(/非対応/)).toBeTruthy();
    expect(
      screen.getByText("この端末では近づけて交換は利用できません"),
    ).toBeTruthy();
  });

  it("SPIKE フラグが無ければリダイレクトして start しない", async () => {
    delete process.env.EXPO_PUBLIC_NEARBY_SPIKE;
    await render(<NearbySpikeScreen />);
    expect(screen.getByText("redirect:/")).toBeTruthy();
    expect(mockStart).not.toHaveBeenCalled();
  });
});
