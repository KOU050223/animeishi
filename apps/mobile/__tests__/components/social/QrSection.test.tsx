import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils/queryClient";
import * as Clipboard from "expo-clipboard";
import { QrSection } from "@/components/social/QrSection";
import { alert } from "@/lib/dialog";
import { ApiRequestError } from "@/lib/apiError";
import { parseQrPayload } from "@/features/friends/qrParser";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";

// react-native-qrcode-svg の描画結果ではなく、QR に埋め込む値を検証するため
// props を記録するスタブに差し替える。
const mockQRCodeProps = jest.fn();
jest.mock("react-native-qrcode-svg", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const MockQRCode = (props: {
    value: string;
    size?: number;
    testID?: string;
  }) => {
    mockQRCodeProps(props);
    return React.createElement(
      Text,
      { testID: props.testID ?? "qr-code" },
      props.value,
    );
  };
  return { __esModule: true, default: MockQRCode };
});

// CameraView の props（onMountError など）を捕捉するため実体を記録する。
let capturedCameraProps: {
  onMountError?: (event: { nativeEvent: { message: string } }) => void;
} | null = null;
jest.mock("expo-camera", () => ({
  CameraView: (props: {
    onMountError?: (event: { nativeEvent: { message: string } }) => void;
    testID?: string;
  }) => {
    capturedCameraProps = props;
    const { View } = require("react-native");
    const React = require("react");
    return React.createElement(View, { testID: props.testID });
  },
  useCameraPermissions: () => [
    { granted: true, canAskAgain: true, expires: "never", status: "granted" },
    jest.fn(),
  ],
}));

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useIsFocused: () => true,
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    const React = require("react");
    React.useEffect(effect, [effect]);
  },
}));

const mockAddFriendMutate = jest.fn();
// 交換キュー（issue #681）。オフライン時の積み上げを検証するため差し替える。
const mockEnqueueExchange = jest.fn();
jest.mock("@/features/friends/exchangeQueue", () => ({
  enqueueExchange: (item: unknown) => mockEnqueueExchange(item),
}));

// 対面交換トークン（issue #417）。QR 値への埋め込みを検証するため
// テストごとに差し替えられるよう変数で持つ。
let mockQrToken: { token: string; expiresAt: number } | undefined = {
  token: "test-qt-token",
  expiresAt: 1999999999,
};
jest.mock("@/features/friends/useFriends", () => ({
  useFriends: () => ({ data: [] }),
  useAddFriend: () => ({ mutate: mockAddFriendMutate, isPending: false }),
  useQrExchangeToken: () => ({ data: mockQrToken }),
}));

// オフライン交換トークンの端末キャッシュ（issue #680）。テストごとに
// 差し替えられるよう変数で持つ。
let mockOfflineToken: string | null = null;
jest.mock("@/features/friends/offlineExchangeToken", () => ({
  readOfflineExchangeToken: () => Promise.resolve(mockOfflineToken),
  saveOfflineExchangeToken: jest.fn(),
}));

// 成立演出の見た目は ExchangeSuccessOverlay 側のテストで担保する。
// ここでは「演出が出る・遷移する・スキャン状態が戻る」の結線だけを見る。
const mockScannerReset = jest.fn();
const mockRequestPermission = jest.fn();
let capturedOnScanned:
  | ((result: {
      userId: string;
      qrToken?: string;
      offlineToken?: string;
      miniMeishi?: { username?: string; avatarUrl?: string };
      raw: string;
    }) => void)
  | undefined;
// カメラ権限の状態。テストごとに差し替える。
let mockScannerPermission: { granted: boolean } | null = { granted: true };
jest.mock("@/features/friends/useQrScanner", () => ({
  useQrScanner: (options: {
    onScanned?: (result: {
      userId: string;
      qrToken?: string;
      offlineToken?: string;
      miniMeishi?: { username?: string; avatarUrl?: string };
      raw: string;
    }) => void;
  }) => {
    capturedOnScanned = options.onScanned;
    return {
      permission: mockScannerPermission,
      requestPermission: mockRequestPermission,
      scanned: false,
      handleBarcodeScanned: jest.fn(),
      reset: mockScannerReset,
    };
  },
}));

// 近づけて交換（issue #693）。既定は非対応端末（従来どおりマイ QR が既定）
// とし、対応端末の分岐だけテストごとに切り替える。中身の画面は
// NearbyExchangeView 側のテストで担保する。
let mockNearbySupported = false;
let mockNearbyPlatformAvailable = false;
jest.mock("@/features/friends/nearbyExchange", () => ({
  nearbyExchange: {
    get platformAvailable() {
      return mockNearbyPlatformAvailable;
    },
    isSupported: () => mockNearbySupported,
  },
}));
jest.mock("@/components/social/nearby/NearbyExchangeView", () => ({
  NearbyExchangeView: ({ onShowQr }: { onShowQr: () => void }) => {
    const { Text } = require("react-native");
    const React = require("react");
    return React.createElement(
      Text,
      { testID: "nearby-exchange-view-stub", onPress: onShowQr },
      "nearby",
    );
  },
}));

jest.mock("@/lib/haptics", () => ({
  haptics: {
    success: jest.fn(),
    warning: jest.fn(),
    selection: jest.fn(),
    impactLight: jest.fn(),
  },
}));

jest.mock("@/lib/dialog", () => ({
  alert: jest.fn(),
  confirm: jest.fn(),
}));

// 共有・画像保存の実体は lib 側で担保済み。ここでは呼び出しの結線だけを見る。
const mockShareTierListUrl = jest.fn();
jest.mock("@/lib/tierList/share", () => ({
  shareTierListUrl: (url: string) => mockShareTierListUrl(url),
}));

const mockSaveQrImage = jest.fn();
jest.mock("@/features/friends/qrImage", () => ({
  saveQrImage: (...args: unknown[]) => mockSaveQrImage(...args),
}));

jest.mock("expo-clipboard", () => ({
  setStringAsync: jest.fn(async () => {}),
}));

// 本番相当の Web URL が埋め込まれることを固定値で表現する。
// buildProfileUrl 自体の解決（EXPO_PUBLIC_WEB_URL 等）は
// lib/profileUrl のテストで担保済み。
jest.mock("@/lib/profileUrl", () => ({
  buildProfileUrl: (userId: string | null | undefined) =>
    userId ? `https://animeishi.uomi.dev/user/${userId}` : null,
}));

// 名刺カードの描画内容ではなく「どの document / プロフィールが渡ったか」を
// 検証するため props を記録するスタブに差し替える。
const mockMeishiCardProps = jest.fn();
jest.mock("@/components/MeishiCard", () => ({
  MeishiCard: (props: unknown) => {
    mockMeishiCardProps(props);
    const { Text } = require("react-native");
    const React = require("react");
    return React.createElement(Text, { testID: "meishi-card-stub" });
  },
}));

let mockProfile:
  | {
      username: string;
      isPublic?: boolean | undefined;
    }
  | undefined = {
  username: "テストユーザー",
};
jest.mock("@/features/me/useProfile", () => ({
  useProfile: () => ({ data: mockProfile }),
}));

// 端末内の名刺ライブラリ（issue #427）。カード構成はテストごとに差し替える。
let mockMeishiCards: { id: string; name: string; document: unknown }[] = [];
let mockDefaultCardId: string | null = null;
jest.mock("@/lib/meishi/useMeishiLibrary", () => ({
  useMeishiLibrary: () => ({
    library: {
      version: 1,
      cards: mockMeishiCards,
      defaultCardId: mockDefaultCardId,
    },
    loaded: true,
    cards: mockMeishiCards,
    defaultCard:
      mockMeishiCards.find((card) => card.id === mockDefaultCardId) ?? null,
    reload: jest.fn(),
    addCard: jest.fn(),
    duplicateCard: jest.fn(),
    removeCard: jest.fn(),
    setDefault: jest.fn(),
    updateCardDocument: jest.fn(),
  }),
}));

const USER_ID = "user_2abcDEF1234567890ghijKLMN";

// MeishiDocument の最小形。document の同一性だけを見る。
const meishiDoc = (tag: string) => ({
  version: 1 as const,
  canvas: {
    aspectRatio: 1.6,
    background: { kind: "solid" as const, color: tag },
  },
  elements: [],
});

const PARTNER_PROFILE = {
  id: "user_partner",
  username: "交換相手",
  bio: "よろしく",
  favoriteQuote: null,
  profileImageUrl: null,
  genres: [],
};

// 自分の公開プロフィール（GET /user/:uid）が返す meishiSnapshotUrl を
// テストごとに差し替えるための fetch モック（issue #593/#595）。
function mockPublicProfileFetch(meishiSnapshotUrl: string | null) {
  global.fetch = jest.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => ({ ...PARTNER_PROFILE, id: USER_ID, meishiSnapshotUrl }),
  })) as unknown as typeof fetch;
}

// expo-image の Image は testID を持たないため、要素タイプで拾う
// （DiscoverUsers.test.tsx と同じ手法）。
const findExpoImages = () =>
  screen.container.queryAll(
    (node) => typeof node.type === "string" && node.type.endsWith("ExpoImage"),
  );

function wrapper({ children }: { children: React.ReactNode }) {
  const client = createTestQueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  jest.clearAllMocks();
  resetAuth();
  capturedOnScanned = undefined;
  capturedCameraProps = null;
  mockScannerPermission = { granted: true };
  mockNearbySupported = false;
  mockNearbyPlatformAvailable = false;
  mockProfile = { username: "テストユーザー" };
  mockMeishiCards = [];
  mockDefaultCardId = null;
  mockQrToken = { token: "test-qt-token", expiresAt: 1999999999 };
  mockOfflineToken = null;
  mockEnqueueExchange.mockResolvedValue({
    id: "queue-id",
    friendId: "user_partner",
    scannedAt: "2026-11-21T10:00:00.000Z",
  });
  // 成立演出が取りに行く公開プロフィール。
  global.fetch = jest.fn(async () => ({
    status: 200,
    ok: true,
    json: async () => PARTNER_PROFILE,
  })) as unknown as typeof fetch;
});

describe("マイQR（QR コード生成）", () => {
  it("カードが画面高さに収まらないときセグメントに被さらないよう、カードと共有ボタンはスクロール可能なコンテナ内にある", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    const scroll = screen.getByTestId("qr-generate-scroll");
    expect(within(scroll).getByTestId("qr-code-container")).toBeTruthy();
    expect(within(scroll).getByTestId("qr-share-link")).toBeTruthy();
    expect(within(scroll).getByTestId("qr-copy-link")).toBeTruthy();
    expect(within(scroll).getByTestId("qr-save-image")).toBeTruthy();
  });

  it("Web 版プロフィール URL に対面交換トークンとミニ名刺を付けて QR に埋め込む", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    const qrValue = mockQRCodeProps.mock.calls
      .map((c) => c[0].value as string)
      .find((v) => v.includes("?qt="));
    expect(qrValue).toContain(
      `https://animeishi.uomi.dev/user/${USER_ID}?qt=test-qt-token`,
    );
    expect(qrValue).toContain("&mc=");
    // ミニ名刺には表示名が入り、読み取り側のパーサーで復元できる。
    expect(parseQrPayload(qrValue)?.miniMeishi).toEqual({
      username: "テストユーザー",
    });
  });

  it("トークン未取得時はトークン無しの URL に落ちる", async () => {
    mockQrToken = undefined;
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    expect(mockQRCodeProps).toHaveBeenCalledWith(
      expect.objectContaining({
        value: `https://animeishi.uomi.dev/user/${USER_ID}`,
      }),
    );
  });

  it("qt を取得できずキャッシュ済みの ot があるとき ?ot= とミニ名刺を載せる（issue #680）", async () => {
    mockQrToken = undefined;
    mockOfflineToken = "cached-ot-token";
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    // ot は AsyncStorage からの読み出し後に反映される。
    await waitFor(() =>
      expect(mockQRCodeProps).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.stringContaining("?ot=cached-ot-token"),
        }),
      ),
    );
    const qrValue = mockQRCodeProps.mock.calls
      .map((c) => c[0].value as string)
      .find((v) => v.includes("?ot="));
    expect(qrValue).not.toContain("qt=");
    expect(qrValue).toContain("&mc=");
    expect(parseQrPayload(qrValue)?.offlineToken).toBe("cached-ot-token");
    expect(parseQrPayload(qrValue)?.miniMeishi).toEqual({
      username: "テストユーザー",
    });
  });

  it("qt があればキャッシュ済みの ot があっても載せない", async () => {
    mockOfflineToken = "cached-ot-token";
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await waitFor(() =>
      expect(mockQRCodeProps).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.stringContaining("?qt=test-qt-token"),
        }),
      ),
    );
    const qrValue = mockQRCodeProps.mock.calls
      .map((c) => c[0].value as string)
      .find((v) => v.includes("?qt="));
    expect(qrValue).not.toContain("ot=");
  });

  it("qt が期限切れならキャッシュ済みの ot にフォールバックする", async () => {
    // オフラインに落ちると直近取得の qt が残るが、期限切れなら載せる意味が
    // ないため ot に切り替える。
    mockQrToken = { token: "expired-qt", expiresAt: 1_000_000_000 };
    mockOfflineToken = "cached-ot-token";
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await waitFor(() =>
      expect(mockQRCodeProps).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.stringContaining("?ot=cached-ot-token"),
        }),
      ),
    );
  });

  it("表示中の qt が期限を迎えると再取得を待たずに ot へ切り替わる", async () => {
    // 再取得が止まるオフライン中でも、期限到達のタイマーで表示を更新する。
    // expiresAt は秒刻みのため 1 秒強で期限を迎える qt を使い、実タイマーで待つ。
    mockQrToken = {
      token: "short-lived-qt",
      expiresAt: Math.floor(Date.now() / 1000) + 1,
    };
    mockOfflineToken = "cached-ot-token";
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await waitFor(() =>
      expect(mockQRCodeProps).toHaveBeenCalledWith(
        expect.objectContaining({
          value: expect.stringContaining("?qt=short-lived-qt"),
        }),
      ),
    );

    // qt の期限到達で再描画され、期限切れの qt ではなく ot が載る。
    await waitFor(
      () =>
        expect(mockQRCodeProps).toHaveBeenCalledWith(
          expect.objectContaining({
            value: expect.stringContaining("?ot=cached-ot-token"),
          }),
        ),
      { timeout: 5000 },
    );
  });

  it("画像で保存のキャプチャ対象はトークン無しの URL を載せた QR カード", async () => {
    // 表示中の QR には qt/ot が載るため、画像に残ると画像経由で期限内に
    // 誰でもフレンドを成立できてしまう。保存用にはトークン無しの
    // shareUrl を載せた別カードを撮る（issue #680 レビュー）。
    mockSaveQrImage.mockResolvedValue(undefined);
    mockOfflineToken = "cached-ot-token";
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    // 画面外にトークン無しの QR が描画されている。
    expect(mockQRCodeProps).toHaveBeenCalledWith(
      expect.objectContaining({
        value: `https://animeishi.uomi.dev/user/${USER_ID}`,
      }),
    );

    await fireEvent.press(screen.getByTestId("qr-save-image"));

    // 撮られるのは画面外カード（qr-save-card）の ref。
    await waitFor(() =>
      expect(mockSaveQrImage).toHaveBeenCalledWith(
        expect.objectContaining({
          current: expect.objectContaining({
            props: expect.objectContaining({ testID: "qr-save-card" }),
          }),
        }),
        expect.anything(),
      ),
    );
  });

  it("生の userId ではなく /user/<id> 形式の URL になる", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    const qr = screen.getByTestId("qr-code");
    expect(qr.props.children).toContain(`/user/${USER_ID}`);
    expect(qr.props.children).not.toBe(USER_ID);
  });

  it("リンクの共有・コピーにはトークンを載せない", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByTestId("qr-copy-link"));

    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
        `https://animeishi.uomi.dev/user/${USER_ID}`,
      ),
    );
  });

  it("未サインインなら QR を表示しない", async () => {
    signedOutUser();
    await render(<QrSection />, { wrapper });

    expect(mockQRCodeProps).not.toHaveBeenCalled();
    expect(
      screen.getByText("QR コードを表示するにはサインインしてください"),
    ).toBeTruthy();
  });

  it("リンクをコピーでプロフィール URL がクリップボードに入り「コピーしました」になる", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByTestId("qr-copy-link"));

    await waitFor(() =>
      expect(Clipboard.setStringAsync).toHaveBeenCalledWith(
        `https://animeishi.uomi.dev/user/${USER_ID}`,
      ),
    );
    await waitFor(() =>
      expect(screen.getByText("コピーしました")).toBeTruthy(),
    );
  });

  it("リンクを共有で共有処理にプロフィール URL が渡される", async () => {
    mockShareTierListUrl.mockResolvedValue("shared");
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByTestId("qr-share-link"));

    await waitFor(() =>
      expect(mockShareTierListUrl).toHaveBeenCalledWith(
        `https://animeishi.uomi.dev/user/${USER_ID}`,
      ),
    );
  });

  it("共有を自動で渡せなかった（blocked）ときは URL 入りのアラートを出す", async () => {
    mockShareTierListUrl.mockResolvedValue("blocked");
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByTestId("qr-share-link"));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "共有できませんでした",
        `https://animeishi.uomi.dev/user/${USER_ID}`,
        { okLabel: "OK" },
      ),
    );
  });

  it("画像で保存で QR カードの画像化・保存が呼ばれる", async () => {
    mockSaveQrImage.mockResolvedValue(undefined);
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByTestId("qr-save-image"));

    await waitFor(() =>
      expect(mockSaveQrImage).toHaveBeenCalledWith(
        expect.objectContaining({ current: expect.anything() }),
        expect.objectContaining({
          title: "マイ QR",
          backgroundColor: "#ffffff",
        }),
      ),
    );
  });

  it("名刺ライブラリが空のとき名刺には document が渡らず、ユーザー名が表示される", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    expect(mockMeishiCardProps).toHaveBeenCalledWith(
      expect.objectContaining({
        document: null,
        username: "テストユーザー",
      }),
    );
    expect(screen.getByTestId("qr-owner-username").props.children).toBe(
      "テストユーザー",
    );
    // カードが 1 枚以下なら渡す名刺の切り替えは出さない。
    expect(screen.queryByTestId("qr-meishi-picker")).toBeNull();
  });

  it("既定の名刺の document が名刺に渡り、プロフィール URL が共有 URL と一致する", async () => {
    const docA = meishiDoc("#111");
    const docB = meishiDoc("#222");
    mockMeishiCards = [
      { id: "card-a", name: "名刺 1", document: docA },
      { id: "card-b", name: "名刺 2", document: docB },
    ];
    mockDefaultCardId = "card-a";
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    expect(mockMeishiCardProps).toHaveBeenCalledWith(
      expect.objectContaining({
        document: docA,
        profileUrl: `https://animeishi.uomi.dev/user/${USER_ID}`,
      }),
    );
  });

  it("複数の名刺があるとき渡す名刺を切り替えられる", async () => {
    const docA = meishiDoc("#111");
    const docB = meishiDoc("#222");
    mockMeishiCards = [
      { id: "card-a", name: "名刺 1", document: docA },
      { id: "card-b", name: "名刺 2", document: docB },
    ];
    mockDefaultCardId = "card-a";
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    // ピッカーには既定の目印が付く。
    expect(screen.getByText("名刺 1（既定）")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("qr-meishi-pick-card-b"));

    expect(mockMeishiCardProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ document: docB }),
    );

    await fireEvent.press(screen.getByTestId("qr-meishi-pick-card-a"));

    expect(mockMeishiCardProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ document: docA }),
    );
  });

  it("名刺が 1 枚だけのとき渡す名刺の切り替えは出さない", async () => {
    mockMeishiCards = [
      { id: "card-a", name: "名刺 1", document: meishiDoc("#111") },
    ];
    mockDefaultCardId = "card-a";
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    expect(screen.queryByTestId("qr-meishi-picker")).toBeNull();
  });

  it("既定の名刺に公開スナップショットがあるとき画像を出し、読み込み完了まで端末内レンダリングを見せる（issue #593/#595）", async () => {
    mockMeishiCards = [
      { id: "card-a", name: "名刺 1", document: meishiDoc("#111") },
    ];
    mockDefaultCardId = "card-a";
    mockPublicProfileFetch(
      "https://api.example/me/meishi-assets/x/public-snapshot.png?v=v1",
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    // スナップショット URL が取れたら画像がマウントされるが、実寸法が
    // 取れるまでは端末内レンダリングの MeishiCard を出し続ける。
    await waitFor(() => expect(findExpoImages()).toHaveLength(1));
    const image = findExpoImages()[0];
    if (!image) throw new Error("ExpoImage が見つかりません");
    expect(JSON.stringify(image.props.source)).toContain(
      "public-snapshot.png?v=v1",
    );
    expect(screen.getByTestId("meishi-card-stub")).toBeTruthy();

    await fireEvent(image, "onLoad", {
      nativeEvent: { source: { width: 1280, height: 824 } },
    });

    // 読み込みが終わったら画像が主役になる。フォールバックは透明に
    // なるだけでツリーには残し、名刺本文の読み上げを維持する。
    const fallback = screen.getByTestId("meishi-snapshot-a11y-fallback");
    expect(fallback.props.pointerEvents).toBe("none");
    expect(within(fallback).getByTestId("meishi-card-stub")).toBeTruthy();
  });

  it("既定の名刺でも公開スナップショットが無ければ端末内レンダリングのままにする", async () => {
    mockMeishiCards = [
      { id: "card-a", name: "名刺 1", document: meishiDoc("#111") },
    ];
    mockDefaultCardId = "card-a";
    mockPublicProfileFetch(null);
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await waitFor(() => expect(global.fetch).toHaveBeenCalled());

    expect(findExpoImages()).toHaveLength(0);
    expect(screen.getByTestId("meishi-card-stub")).toBeTruthy();
  });

  it("既定以外の名刺を選んだときは公開スナップショットを使わず端末内レンダリングにする", async () => {
    const docA = meishiDoc("#111");
    const docB = meishiDoc("#222");
    mockMeishiCards = [
      { id: "card-a", name: "名刺 1", document: docA },
      { id: "card-b", name: "名刺 2", document: docB },
    ];
    mockDefaultCardId = "card-a";
    mockPublicProfileFetch(
      "https://api.example/me/meishi-assets/x/public-snapshot.png?v=v1",
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await waitFor(() => expect(findExpoImages()).toHaveLength(1));
    await fireEvent.press(screen.getByTestId("qr-meishi-pick-card-b"));

    expect(findExpoImages()).toHaveLength(0);
    expect(mockMeishiCardProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ document: docB }),
    );
  });

  it("プロフィールが非公開のとき警告を出し、「公開設定を開く」でプロフィールタブへ遷移する（issue #676）", async () => {
    mockProfile = { username: "テストユーザー", isPublic: false };
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    const warning = screen.getByTestId("qr-private-warning");
    expect(
      within(warning).getByText(
        "プロフィールが非公開のため、アプリを持っていない相手には名刺が表示されません",
      ),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByTestId("qr-private-warning-open-settings"),
    );

    expect(mockPush).toHaveBeenCalledWith("/(tabs)/profile");
  });

  it.each([true, undefined])(
    "プロフィールの isPublic が %s のとき警告は出さない",
    async (isPublic) => {
      mockProfile = { username: "テストユーザー", isPublic };
      loggedInUser({ userId: USER_ID });
      await render(<QrSection />, { wrapper });

      expect(screen.queryByTestId("qr-private-warning")).toBeNull();
    },
  );

  it("スナップショット画像の読み込みに失敗したら端末内レンダリングにフォールバックする", async () => {
    mockMeishiCards = [
      { id: "card-a", name: "名刺 1", document: meishiDoc("#111") },
    ];
    mockDefaultCardId = "card-a";
    mockPublicProfileFetch(
      "https://api.example/me/meishi-assets/x/public-snapshot.png?v=v1",
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await waitFor(() => expect(findExpoImages()).toHaveLength(1));
    await fireEvent(findExpoImages()[0]!, "onError", { nativeEvent: {} });

    expect(findExpoImages()).toHaveLength(0);
    expect(screen.getByTestId("meishi-card-stub")).toBeTruthy();
  });
});

describe("スキャン", () => {
  it("スキャンタブに切り替えられる", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));

    expect(screen.getByText("QR コードを枠内に収めてください")).toBeTruthy();
  });

  it("トークン付き QR のフレンド追加が成立したら名刺交換成立の演出を出し、「プロフィールを見る」で遷移する", async () => {
    mockAddFriendMutate.mockImplementation(
      (
        _vars: unknown,
        options?: { onSuccess?: (result: { meetingCount: number }) => void },
      ) => options?.onSuccess?.({ meetingCount: 1 }),
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        qrToken: "scanned-qt",
        raw: "https://animeishi.uomi.dev/user/user_partner?qt=scanned-qt",
      }),
    );

    expect(mockAddFriendMutate).toHaveBeenCalledWith(
      { friendId: "user_partner", qrToken: "scanned-qt" },
      expect.any(Object),
    );
    await waitFor(() => expect(screen.getByText("名刺交換成立")).toBeTruthy());
    expect(alert).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId("exchange-success-profile-link"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "user_partner" },
    });
    // 演出を閉じるとスキャン状態がリセットされる（alert の onClose 相当）。
    expect(mockScannerReset).toHaveBeenCalled();
  });

  it("成立演出を「閉じる」で閉じるとスキャン状態がリセットされる", async () => {
    mockAddFriendMutate.mockImplementation(
      (
        _vars: unknown,
        options?: { onSuccess?: (result: { meetingCount: number }) => void },
      ) => options?.onSuccess?.({ meetingCount: 1 }),
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        qrToken: "scanned-qt",
        raw: "https://animeishi.uomi.dev/user/user_partner?qt=scanned-qt",
      }),
    );
    await waitFor(() => expect(screen.getByText("名刺交換成立")).toBeTruthy());

    await fireEvent.press(screen.getByTestId("exchange-success-close"));

    expect(mockScannerReset).toHaveBeenCalled();
    expect(screen.queryByTestId("exchange-success-overlay")).toBeNull();
  });

  it("ot だけ載った QR は offlineToken で即時追加を試す（issue #680）", async () => {
    mockAddFriendMutate.mockImplementation(
      (
        _vars: unknown,
        options?: { onSuccess?: (result: { meetingCount: number }) => void },
      ) => options?.onSuccess?.({ meetingCount: 1 }),
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        offlineToken: "scanned-ot",
        raw: "https://animeishi.uomi.dev/user/user_partner?ot=scanned-ot",
      }),
    );

    expect(mockAddFriendMutate).toHaveBeenCalledWith(
      {
        friendId: "user_partner",
        qrToken: undefined,
        offlineToken: "scanned-ot",
      },
      expect.any(Object),
    );
    await waitFor(() => expect(screen.getByText("名刺交換成立")).toBeTruthy());
  });

  it("トークン無しの QR（共有 URL）は即時追加せずプロフィールへ誘導する", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        raw: "https://animeishi.uomi.dev/user/user_partner",
      }),
    );

    expect(mockAddFriendMutate).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "user_partner" },
    });
    expect(mockScannerReset).toHaveBeenCalled();
  });

  it("期限切れトークン（qr_exchange_required）は alert の後プロフィールへ誘導する", async () => {
    mockAddFriendMutate.mockImplementation(
      (_vars: unknown, options?: { onError?: (e: unknown) => void }) =>
        options?.onError?.(
          new ApiRequestError(
            403,
            "QR の有効期限が切れています",
            "qr_exchange_required",
          ),
        ),
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        qrToken: "expired-qt",
        raw: "https://animeishi.uomi.dev/user/user_partner?qt=expired-qt",
      }),
    );

    expect(alert).toHaveBeenCalledWith(
      "QR の有効期限が切れています",
      "プロフィール画面からフレンド申請を送れます",
      { okLabel: "OK", onClose: expect.any(Function) },
    );
    // alert の OK でプロフィール（申請ボタン）へ誘導する。
    const onClose = jest.mocked(alert).mock.calls[0]?.[2]?.onClose;
    await act(async () => onClose?.());
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "user_partner" },
    });
  });

  it("カメラ権限が拒否されているときは許可を求めるフォールバックを出す", async () => {
    mockScannerPermission = { granted: false };
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));

    expect(
      screen.getByText("QR コードをスキャンするにはカメラの許可が必要です"),
    ).toBeTruthy();

    await fireEvent.press(screen.getByTestId("scan-fallback-retry"));

    expect(mockRequestPermission).toHaveBeenCalled();
  });

  it("カメラの起動に失敗したらフォールバックを出し、再試行で再マウントする", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    expect(screen.getByTestId("qr-camera-view")).toBeTruthy();

    await act(async () =>
      capturedCameraProps?.onMountError?.({
        nativeEvent: { message: "Could not start camera" },
      }),
    );

    expect(screen.getByText("カメラを起動できませんでした")).toBeTruthy();
    expect(screen.queryByTestId("qr-camera-view")).toBeNull();

    await fireEvent.press(screen.getByTestId("scan-fallback-retry"));

    expect(screen.getByTestId("qr-camera-view")).toBeTruthy();
  });

  it("フレンド追加に失敗したら従来どおりエラーの alert を出す", async () => {
    mockAddFriendMutate.mockImplementation(
      (_vars: unknown, options?: { onError?: (e: unknown) => void }) =>
        options?.onError?.(
          new ApiRequestError(500, "フレンド追加に失敗しました"),
        ),
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        qrToken: "scanned-qt",
        raw: "https://animeishi.uomi.dev/user/user_partner?qt=scanned-qt",
      }),
    );

    expect(alert).toHaveBeenCalledWith(
      "追加できませんでした",
      "フレンド追加に失敗しました",
      { okLabel: "OK", onClose: expect.any(Function) },
    );
    expect(screen.queryByTestId("exchange-success-overlay")).toBeNull();
  });

  it("POST がネットワークに届かない失敗では交換キューへ積み、オフライン受付画面を出す（issue #681）", async () => {
    mockAddFriendMutate.mockImplementation(
      (_vars: unknown, options?: { onError?: (e: unknown) => void }) =>
        options?.onError?.(new TypeError("Network request failed")),
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        offlineToken: "scanned-ot",
        miniMeishi: { username: "オフライン相手" },
        raw: "https://animeishi.uomi.dev/user/user_partner?ot=scanned-ot",
      }),
    );

    // キューにはミニ名刺とトークンが入る（scannedAt は登録側でスタンプする）。
    await waitFor(() =>
      expect(mockEnqueueExchange).toHaveBeenCalledWith(
        expect.objectContaining({
          friendId: "user_partner",
          offlineToken: "scanned-ot",
          miniMeishi: { username: "オフライン相手" },
        }),
      ),
    );
    // 成立ではなく受付なので「接続が回復したら交換が完了する」旨を出し、
    // 失敗の alert は出さない。
    await waitFor(() =>
      expect(
        screen.getByText("接続が回復したら名刺交換が完了します"),
      ).toBeTruthy(),
    );
    expect(screen.getByText("オフライン相手")).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();

    // 受付画面を閉じるとスキャン状態がリセットされる。
    await fireEvent.press(screen.getByTestId("exchange-queued-close"));
    expect(mockScannerReset).toHaveBeenCalled();
    expect(screen.queryByTestId("exchange-queued-overlay")).toBeNull();
  });

  it("成立画面の「自分の QR も見せる」でマイ QR 表示へ切り替わる（issue #682）", async () => {
    mockAddFriendMutate.mockImplementation(
      (
        _vars: unknown,
        options?: { onSuccess?: (result: { meetingCount: number }) => void },
      ) => options?.onSuccess?.({ meetingCount: 1 }),
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        qrToken: "scanned-qt",
        raw: "https://animeishi.uomi.dev/user/user_partner?qt=scanned-qt",
      }),
    );
    await waitFor(() => expect(screen.getByText("名刺交換成立")).toBeTruthy());

    await fireEvent.press(screen.getByTestId("exchange-success-show-my-qr"));

    // 相互スキャンを促すため、オーバーレイを畳んで自分の QR 表示に戻る。
    expect(screen.queryByTestId("exchange-success-overlay")).toBeNull();
    expect(screen.getByTestId("qr-generate-scroll")).toBeTruthy();
    expect(screen.getByTestId("qr-code-container")).toBeTruthy();
  });

  it("オフライン受付画面の「自分の QR も見せる」でもマイ QR 表示へ切り替わる", async () => {
    mockAddFriendMutate.mockImplementation(
      (_vars: unknown, options?: { onError?: (e: unknown) => void }) =>
        options?.onError?.(new TypeError("Network request failed")),
    );
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        offlineToken: "scanned-ot",
        raw: "https://animeishi.uomi.dev/user/user_partner?ot=scanned-ot",
      }),
    );
    await waitFor(() =>
      expect(screen.getByText("名刺交換を受け付けました")).toBeTruthy(),
    );

    await fireEvent.press(screen.getByTestId("exchange-queued-show-my-qr"));

    expect(screen.queryByTestId("exchange-queued-overlay")).toBeNull();
    expect(screen.getByTestId("qr-generate-scroll")).toBeTruthy();
    expect(screen.getByTestId("qr-code-container")).toBeTruthy();
  });

  it("キューへの保存自体に失敗したら従来どおりエラーの alert を出す", async () => {
    mockAddFriendMutate.mockImplementation(
      (_vars: unknown, options?: { onError?: (e: unknown) => void }) =>
        options?.onError?.(new TypeError("Network request failed")),
    );
    mockEnqueueExchange.mockRejectedValueOnce(new Error("storage full"));
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    await fireEvent.press(screen.getByLabelText("スキャン"));
    await act(async () =>
      capturedOnScanned?.({
        userId: "user_partner",
        offlineToken: "scanned-ot",
        raw: "https://animeishi.uomi.dev/user/user_partner?ot=scanned-ot",
      }),
    );

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith(
        "追加できませんでした",
        "フレンド追加に失敗しました",
        { okLabel: "OK", onClose: expect.any(Function) },
      ),
    );
    expect(screen.queryByTestId("exchange-queued-overlay")).toBeNull();
  });
});

describe("近づける（issue #693）", () => {
  it("対応端末では「近づける」が既定で開き、QR へ切り替えられる", async () => {
    mockNearbyPlatformAvailable = true;
    mockNearbySupported = true;
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    expect(screen.getByTestId("nearby-exchange-view-stub")).toBeTruthy();
    expect(screen.queryByTestId("qr-generate-scroll")).toBeNull();

    await fireEvent.press(screen.getByTestId("nearby-exchange-view-stub"));
    expect(screen.getByTestId("qr-generate-scroll")).toBeTruthy();
  });

  it("UWB 非対応の iPhone でも「近づける」を既定にする（近くの人をタップして交換できる）", async () => {
    mockNearbyPlatformAvailable = true;
    mockNearbySupported = false;
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    expect(screen.getByTestId("nearby-exchange-view-stub")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("マイQR"));
    expect(screen.getByTestId("qr-generate-scroll")).toBeTruthy();
  });

  it("近づけて交換の実装が無いプラットフォームでは「近づける」を出さない", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    expect(screen.queryByTestId("qr-mode-nearby")).toBeNull();
    expect(screen.getByTestId("qr-generate-scroll")).toBeTruthy();
  });
});
