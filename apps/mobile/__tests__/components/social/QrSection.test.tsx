import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { QrSection } from "@/components/social/QrSection";
import { alert } from "@/lib/dialog";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth, signedOutUser } from "@/test-utils/auth";

// react-native-qrcode-svg の描画結果ではなく、QR に埋め込む値を検証するため
// props を記録するスタブに差し替える。
const mockQRCodeProps = jest.fn();
jest.mock("react-native-qrcode-svg", () => {
  const React = require("react");
  const { Text } = require("react-native");
  const MockQRCode = (props: { value: string; size?: number }) => {
    mockQRCodeProps(props);
    return React.createElement(Text, { testID: "qr-code" }, props.value);
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
// 対面交換トークン（issue #417）。QR 値への埋め込みを検証するため
// テストごとに差し替えられるよう変数で持つ。
let mockQrToken: { token: string; expiresAt: number } | undefined = {
  token: "test-qt-token",
  expiresAt: 1999999999,
};
jest.mock("@/lib/useFriends", () => ({
  useAddFriend: () => ({ mutate: mockAddFriendMutate, isPending: false }),
  useQrExchangeToken: () => ({ data: mockQrToken }),
}));

// 成立演出の見た目は ExchangeSuccessOverlay 側のテストで担保する。
// ここでは「演出が出る・遷移する・スキャン状態が戻る」の結線だけを見る。
const mockScannerReset = jest.fn();
const mockRequestPermission = jest.fn();
let capturedOnScanned:
  | ((result: { userId: string; qrToken?: string; raw: string }) => void)
  | undefined;
// カメラ権限の状態。テストごとに差し替える。
let mockScannerPermission: { granted: boolean } | null = { granted: true };
jest.mock("@/lib/useQrScanner", () => ({
  useQrScanner: (options: {
    onScanned?: (result: {
      userId: string;
      qrToken?: string;
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
jest.mock("@/lib/qrImage", () => ({
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

let mockProfile: { username: string } | undefined = {
  username: "テストユーザー",
};
jest.mock("@/lib/useProfile", () => ({
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

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
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
  mockProfile = { username: "テストユーザー" };
  mockMeishiCards = [];
  mockDefaultCardId = null;
  mockQrToken = { token: "test-qt-token", expiresAt: 1999999999 };
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

  it("Web 版プロフィール URL に対面交換トークンを付けて QR に埋め込む", async () => {
    loggedInUser({ userId: USER_ID });
    await render(<QrSection />, { wrapper });

    expect(mockQRCodeProps).toHaveBeenCalledWith(
      expect.objectContaining({
        value: `https://animeishi.uomi.dev/user/${USER_ID}?qt=test-qt-token`,
      }),
    );
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
    const image = await screen.findByTestId("meishi-snapshot-image");
    expect(JSON.stringify(image.props.source)).toContain(
      "public-snapshot.png?v=v1",
    );
    expect(screen.getByTestId("meishi-card-stub")).toBeTruthy();

    await fireEvent(image, "onLoad", {
      nativeEvent: { source: { width: 1280, height: 824 } },
    });

    // 読み込みが終わったら画像が主役になり、フォールバックは外れる。
    expect(screen.queryByTestId("meishi-card-stub")).toBeNull();
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

    expect(screen.queryByTestId("meishi-snapshot-image")).toBeNull();
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

    await screen.findByTestId("meishi-snapshot-image");
    await fireEvent.press(screen.getByTestId("qr-meishi-pick-card-b"));

    expect(screen.queryByTestId("meishi-snapshot-image")).toBeNull();
    expect(mockMeishiCardProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ document: docB }),
    );
  });

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

    const image = await screen.findByTestId("meishi-snapshot-image");
    await fireEvent(image, "onError", { nativeEvent: {} });

    expect(screen.queryByTestId("meishi-snapshot-image")).toBeNull();
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
      (_vars: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
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
      (_vars: unknown, options?: { onSuccess?: () => void }) =>
        options?.onSuccess?.(),
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
        options?.onError?.(new Error("すでにフレンドです")),
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
});
