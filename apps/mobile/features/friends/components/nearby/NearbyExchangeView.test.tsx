import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { NearbyExchangeView } from "./NearbyExchangeView";
import {
  GAP_MIN_MS,
  LAND_MS,
  RECEIVE_MS,
  SEND_MS,
} from "./NearbyExchangeStage";
import { alert } from "@/lib/dialog";
import { ApiRequestError } from "@/lib/apiError";
import { TAP_REQUEST_TIMEOUT_MS } from "@/features/friends/nearbyExchange/useNearbyExchangeSession";
import {
  encodeNearbyMessage,
  type NearbyExchangeModuleEvents,
  type NearbyMessage,
} from "@/features/friends/nearbyExchange";

const dataMessage = (url: string) => encodeNearbyMessage({ kind: "data", url });
const signal = (kind: Exclude<NearbyMessage["kind"], "data">) =>
  encodeNearbyMessage({ kind });

// ネイティブモジュールの窓口だけを差し替え、状態遷移（reducer）と
// ハプティクスの判定は本物を通す。
type Listener = (payload: unknown) => void;
const mockListeners = new Map<string, Set<Listener>>();
const mockSendPayload = jest.fn();
const mockStart = jest.fn();
let mockSupported = true;
jest.mock("@/features/friends/nearbyExchange/nearbyExchange", () => ({
  nearbyExchange: {
    platformAvailable: true,
    isSupported: () => mockSupported,
    start: (options: unknown) => mockStart(options),
    stop: jest.fn(),
    sendPayload: (peerId: string, payload: string) =>
      mockSendPayload(peerId, payload),
    addListener: (event: string, listener: Listener) => {
      const set = mockListeners.get(event) ?? new Set<Listener>();
      set.add(listener);
      mockListeners.set(event, set);
      return { remove: () => set.delete(listener) };
    },
  },
}));

async function emit<E extends keyof NearbyExchangeModuleEvents>(
  event: E,
  payload: Parameters<NearbyExchangeModuleEvents[E]>[0],
) {
  await act(async () => {
    mockListeners.get(event)?.forEach((listener) => listener(payload));
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

const MY_QR = "https://animeishi.uomi.dev/user/user_me?qt=my-qt";
const MY_NEARBY_PAYLOAD =
  "https://animeishi.uomi.dev/user/user_me?qt=my-qt&ot=my-ot";
const PARTNER_QR =
  "https://animeishi.uomi.dev/user/user_partner2abcDEF?qt=partner-qt";

jest.mock("@/features/friends/useExchangeQrValue", () => ({
  useExchangeQrValue: () => ({
    qrValue: MY_QR,
    nearbyPayload: MY_NEARBY_PAYLOAD,
    shareUrl: "https://animeishi.uomi.dev/user/user_me",
  }),
}));

jest.mock("expo-router", () => ({
  useIsFocused: () => true,
}));

const mockAddFriendMutate = jest.fn();
jest.mock("@/features/friends/useFriends", () => ({
  useAddFriend: () => ({ mutate: mockAddFriendMutate, isPending: false }),
}));

const mockEnqueueExchange = jest.fn();
jest.mock("@/features/friends/exchangeQueue", () => ({
  enqueueExchange: (item: unknown) => mockEnqueueExchange(item),
}));

jest.mock("@/features/me/useProfile", () => ({
  useProfile: () => ({ data: { username: "みお" } }),
}));

jest.mock("@/features/meishi/useMeishiLibrary", () => ({
  useMeishiLibrary: () => ({ defaultCard: null }),
}));

jest.mock("@/features/meishi/components/MeishiCard", () => ({
  MeishiCard: () => {
    const { View } = require("react-native");
    return require("react").createElement(View, { testID: "my-meishi" });
  },
}));

// 成立後の画面の流れは ExchangeResultLayer（ScanView と共有）側で担保する。
const mockResultLayerProps = jest.fn();
jest.mock("@/features/friends/components/ExchangeResultLayer", () => ({
  ExchangeResultLayer: (props: { result: { kind: string } }) => {
    mockResultLayerProps(props);
    const { Text } = require("react-native");
    return require("react").createElement(
      Text,
      { testID: `result-${props.result.kind}` },
      props.result.kind,
    );
  },
}));

jest.mock("@/lib/dialog", () => ({ alert: jest.fn() }));

jest.mock("@/lib/haptics", () => ({
  haptics: {
    success: jest.fn(),
    selection: jest.fn(),
    impactLight: jest.fn(),
    impactMedium: jest.fn(),
    impactHeavy: jest.fn(),
  },
}));

// 送る＋間 → 受け取る＋着地 の 2 段。後段のタイマーは前段の state 更新後に
// 張られるため、まとめて進めずに区切る。
async function playSwap() {
  await advance(SEND_MS + GAP_MIN_MS);
  await advance(RECEIVE_MS + LAND_MS);
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockListeners.clear();
  mockSupported = true;
});

afterEach(() => {
  jest.useRealTimers();
});

async function touchPartner() {
  await emit("onPeerFound", { peerId: "p1", displayName: "ハル", uwb: true });
  await emit("onDistance", { peerId: "p1", meters: 0.08 });
}

describe("NearbyExchangeView", () => {
  it("開くと自分の名前で探索を始め、見つかった相手の名前を出す", async () => {
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    expect(mockStart).toHaveBeenCalledWith({ displayName: "みお" });
    expect(screen.getByText("近くの人を探しています")).toBeTruthy();

    await emit("onPeerFound", { peerId: "p1", displayName: "ハル", uwb: true });
    expect(screen.getByText("ハルさんが見つかりました")).toBeTruthy();

    await emit("onDistance", { peerId: "p1", meters: 0.4 });
    expect(screen.getByText("その調子")).toBeTruthy();
  });

  it("10cm で自分の QR と同じデータを相手へ送り、届いたデータで QR と同じ交換を登録して成立を出す", async () => {
    mockAddFriendMutate.mockImplementation(
      (_vars, options: { onSuccess: (r: unknown) => void }) =>
        options.onSuccess({ meetingCount: 1, recordId: 7 }),
    );
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await touchPartner();

    expect(mockSendPayload).toHaveBeenCalledWith(
      "p1",
      dataMessage(MY_NEARBY_PAYLOAD),
    );
    expect(screen.getByText("あなたの名刺を ハルさんへ")).toBeTruthy();

    await emit("onPayload", { peerId: "p1", payload: dataMessage(PARTNER_QR) });
    expect(mockAddFriendMutate).toHaveBeenCalledWith(
      {
        friendId: "user_partner2abcDEF",
        qrToken: "partner-qt",
        offlineToken: undefined,
      },
      expect.anything(),
    );
    // 着地まで成立の画面は出さない。
    expect(screen.queryByTestId("result-success")).toBeNull();

    await playSwap();
    expect(screen.getByTestId("result-success")).toBeTruthy();
    expect(mockResultLayerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        result: {
          kind: "success",
          uid: "user_partner2abcDEF",
          meetingCount: 1,
          recordId: 7,
        },
      }),
    );
  });

  it("相手が先に送ってきたら、こちらからも送り返す", async () => {
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onPeerFound", { peerId: "p1", displayName: "ハル", uwb: true });
    await emit("onDistance", { peerId: "p1", meters: 0.15 });
    await emit("onPayload", { peerId: "p1", payload: dataMessage(PARTNER_QR) });

    expect(mockSendPayload).toHaveBeenCalledWith(
      "p1",
      dataMessage(MY_NEARBY_PAYLOAD),
    );
    expect(mockAddFriendMutate).toHaveBeenCalledTimes(1);
  });

  it("通信できないときは交換キューへ積み、受付の画面を出す", async () => {
    mockAddFriendMutate.mockImplementation(
      (_vars, options: { onError: (e: unknown) => void }) =>
        options.onError(new TypeError("Network request failed")),
    );
    mockEnqueueExchange.mockResolvedValue({ id: "q1" });
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await touchPartner();
    await emit("onPayload", { peerId: "p1", payload: dataMessage(PARTNER_QR) });
    await playSwap();

    expect(mockEnqueueExchange).toHaveBeenCalledWith(
      expect.objectContaining({
        friendId: "user_partner2abcDEF",
        qrToken: "partner-qt",
      }),
    );
    expect(screen.getByTestId("result-queued")).toBeTruthy();
  });

  it("サーバーが交換を断ったら着地後に失敗を知らせる", async () => {
    mockAddFriendMutate.mockImplementation(
      (_vars, options: { onError: (e: unknown) => void }) =>
        options.onError(
          new ApiRequestError(400, "expired", "qr_exchange_required"),
        ),
    );
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await touchPartner();
    await emit("onPayload", { peerId: "p1", payload: dataMessage(PARTNER_QR) });
    await playSwap();

    expect(alert).toHaveBeenCalledWith(
      "追加できませんでした",
      "フレンド追加に失敗しました",
      expect.objectContaining({ okLabel: "OK" }),
    );
    expect(screen.queryByTestId("result-success")).toBeNull();
  });

  it("近くにいると測れていない相手から届いたデータには応じない", async () => {
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onPeerFound", { peerId: "p1", displayName: "ハル", uwb: true });
    await emit("onPayload", { peerId: "p1", payload: dataMessage(PARTNER_QR) });

    expect(mockSendPayload).not.toHaveBeenCalled();
    expect(mockAddFriendMutate).not.toHaveBeenCalled();
  });

  it("許可を拒否した後、アプリに戻ると探索をやり直す", async () => {
    const { AppState } = require("react-native");
    const handlers: ((s: string) => void)[] = [];
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_e: unknown, h: unknown) => {
        handlers.push(h as (s: string) => void);
        return { remove: jest.fn() };
      });
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onError", { code: "local_network_denied", message: "" });
    expect(screen.getByTestId("nearby-fallback-denied")).toBeTruthy();
    mockStart.mockClear();

    await act(async () => handlers.forEach((h) => h("active")));
    expect(screen.getByTestId("nearby-exchange-view")).toBeTruthy();
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("交換トークンの無いデータは登録せず知らせる", async () => {
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await touchPartner();
    await emit("onPayload", {
      peerId: "p1",
      payload: dataMessage(
        "https://animeishi.uomi.dev/user/user_partner2abcDEF",
      ),
    });

    expect(mockAddFriendMutate).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      "交換できませんでした",
      expect.any(String),
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("相手のデータが届かないまま時間切れになったら、もう一度近づけるよう案内する", async () => {
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await touchPartner();
    await advance(6000);

    expect(screen.getByTestId("nearby-failure-notice")).toBeTruthy();
    expect(mockAddFriendMutate).not.toHaveBeenCalled();
  });

  it("実装の無いプラットフォームでは理由と QR を出す", async () => {
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onError", { code: "unsupported_platform", message: "" });

    expect(screen.getByTestId("nearby-fallback-unsupported")).toBeTruthy();
  });
});

describe("NearbyExchangeView（タップで交換）", () => {
  const PARTNER = { peerId: "p1", displayName: "ハル" };

  it("UWB 非対応の端末でも探索を始め、タップで交換することを伝える", async () => {
    mockSupported = false;
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);

    expect(mockStart).toHaveBeenCalledWith({ displayName: "みお" });
    expect(screen.getByTestId("nearby-tap-mode-banner")).toBeTruthy();
    await emit("onPeerFound", { ...PARTNER, uwb: true });
    expect(screen.getByTestId("nearby-tap-peer-p1")).toBeTruthy();
    expect(screen.getByText("相手をタップして交換を申し込めます")).toBeTruthy();
  });

  it("相手が UWB 非対応なら、10cm を測っても始めずタップの一覧に出す", async () => {
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onPeerFound", { ...PARTNER, uwb: false });
    await emit("onDistance", { peerId: "p1", meters: 0.05 });

    expect(mockSendPayload).not.toHaveBeenCalled();
    expect(screen.getByTestId("nearby-tap-peer-p1")).toBeTruthy();
  });

  it("タップで申し込み、相手が承認したら交換データを送り、届いたデータで成立させる", async () => {
    mockAddFriendMutate.mockImplementation(
      (_vars, options: { onSuccess: (r: unknown) => void }) =>
        options.onSuccess({ meetingCount: 1, recordId: 7 }),
    );
    mockSupported = false;
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onPeerFound", { ...PARTNER, uwb: false });

    await fireEvent.press(screen.getByTestId("nearby-tap-request-p1"));
    expect(mockSendPayload).toHaveBeenCalledWith("p1", signal("request"));
    expect(screen.getByText("返事を待っています…")).toBeTruthy();
    // 承認が来るまで交換データは送らない。
    expect(mockSendPayload).not.toHaveBeenCalledWith(
      "p1",
      dataMessage(MY_NEARBY_PAYLOAD),
    );

    await emit("onPayload", { peerId: "p1", payload: signal("accept") });
    expect(mockSendPayload).toHaveBeenCalledWith(
      "p1",
      dataMessage(MY_NEARBY_PAYLOAD),
    );

    await emit("onPayload", { peerId: "p1", payload: dataMessage(PARTNER_QR) });
    expect(mockAddFriendMutate).toHaveBeenCalledTimes(1);
    await playSwap();
    expect(screen.getByTestId("result-success")).toBeTruthy();
  });

  it("申し込まれたら確認を出し、承認したときだけ承認と交換データを送る", async () => {
    mockSupported = false;
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onPeerFound", { ...PARTNER, uwb: false });
    await emit("onPayload", { peerId: "p1", payload: signal("request") });

    expect(screen.getByText("ハルさんと名刺を交換しますか？")).toBeTruthy();
    expect(mockSendPayload).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("nearby-request-accept"));
    expect(mockSendPayload.mock.calls).toEqual([
      ["p1", signal("accept")],
      ["p1", dataMessage(MY_NEARBY_PAYLOAD)],
    ]);
    expect(screen.queryByTestId("nearby-request-card")).toBeNull();
  });

  it("申し込みを断ったら断りだけを送り、交換データは送らない", async () => {
    mockSupported = false;
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onPeerFound", { ...PARTNER, uwb: false });
    await emit("onPayload", { peerId: "p1", payload: signal("request") });
    await fireEvent.press(screen.getByTestId("nearby-request-decline"));

    expect(mockSendPayload.mock.calls).toEqual([["p1", signal("decline")]]);
  });

  it("相手が申し込みを取り下げたら確認を閉じる", async () => {
    mockSupported = false;
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onPeerFound", { ...PARTNER, uwb: false });
    await emit("onPayload", { peerId: "p1", payload: signal("request") });
    await emit("onPayload", { peerId: "p1", payload: signal("cancel") });

    expect(screen.queryByTestId("nearby-request-card")).toBeNull();
  });

  it("断られたら知らせ、返事が無ければ時間切れで申し込みを取り下げる", async () => {
    mockSupported = false;
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onPeerFound", { ...PARTNER, uwb: false });
    await fireEvent.press(screen.getByTestId("nearby-tap-request-p1"));
    await emit("onPayload", { peerId: "p1", payload: signal("decline") });
    expect(screen.getByText("ハルさんとは交換しませんでした")).toBeTruthy();

    await advance(4000);
    await fireEvent.press(screen.getByTestId("nearby-tap-request-p1"));
    await advance(TAP_REQUEST_TIMEOUT_MS);
    expect(mockSendPayload).toHaveBeenLastCalledWith("p1", signal("cancel"));
    expect(screen.getByText("ハルさんから返事がありませんでした")).toBeTruthy();
  });

  it("許可が拒否されたら設定への導線と QR を出す", async () => {
    await render(<NearbyExchangeView onShowQr={jest.fn()} />);
    await emit("onError", { code: "local_network_denied", message: "" });

    expect(screen.getByTestId("nearby-fallback-denied")).toBeTruthy();
    expect(screen.getByTestId("nearby-open-settings")).toBeTruthy();
  });
});
