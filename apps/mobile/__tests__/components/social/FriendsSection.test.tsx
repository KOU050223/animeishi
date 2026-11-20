// フレンドセクション（QR・フレンドタブ内）のテスト。削除失敗は画面に変化が残らないため、
// OK を押すまで消えないダイアログで必ず通知することを確認する。
import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { FriendsSection } from "@/components/social/FriendsSection";
import { ApiRequestError } from "@/lib/apiError";

const mockRemoveMutateAsync = jest.fn();
const mockPush = jest.fn();
const mockAlert = jest.fn();
let mockFriendsLoading = false;
let mockFriendsError = false;
// confirm は「ユーザーが承諾した」として即座に onConfirm を呼ぶ。
const mockConfirm = jest.fn(
  (
    _title: string,
    _message: string,
    onConfirm: () => void,
    _options?: unknown,
  ) => onConfirm(),
);

type MockRequestItem = {
  id: number;
  userId: string;
  username: string;
  bio: string | null;
  favoriteQuote: string | null;
  profileImageUrl: string | null;
};

let mockRequestsData: {
  received: MockRequestItem[];
  sent: MockRequestItem[];
} = { received: [], sent: [] };

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (...args: unknown[]) => mockPush(...args) }),
  // フォーカス復帰の再取得（issue #694）。効果自体はここでは見ない。
  useFocusEffect: () => {},
}));

// MeishiCard が Gesture を import するため、ネイティブモジュールを読まない
// スタブに差し替える（PropertyPanel.test.tsx と同じパターン）。
jest.mock("react-native-gesture-handler", () => {
  const chain: Record<string, unknown> = {};
  for (const name of [
    "runOnJS",
    "onUpdate",
    "onStart",
    "onEnd",
    "onFinalize",
    "onTouchesDown",
    "onTouchesMove",
    "onTouchesUp",
    "simultaneousWithExternalGesture",
    "enabled",
    "minDistance",
    "minPointers",
    "maxPointers",
    "activeOffsetX",
    "activeOffsetY",
  ]) {
    chain[name] = () => chain;
  }
  const gesture = () => chain;
  return {
    Gesture: {
      Pan: gesture,
      Pinch: gesture,
      Tap: gesture,
      Exclusive: gesture,
      Simultaneous: gesture,
    },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
  };
});

// 名刺帳の既定のモック相手。createdAt / source は名刺カードの
// 交換日表示に使う（issue #659）。
const mockFriend = {
  friendId: "friend_1",
  createdAt: "2026-11-10T00:00:00.000Z",
  source: "qr" as "qr" | "request" | null,
  username: "友達A",
  bio: null,
  favoriteQuote: null,
  profileImageUrl: null,
  meishiSnapshotUrl: null,
};

let mockFriendsData: (typeof mockFriend)[] = [mockFriend];

jest.mock("@/lib/useFriends", () => ({
  useFriends: () => ({
    data: mockFriendsData,
    isLoading: mockFriendsLoading,
    isError: mockFriendsError,
    refetch: jest.fn(),
  }),
  useRemoveFriend: () => ({
    mutateAsync: (...args: unknown[]) => mockRemoveMutateAsync(...args),
  }),
}));

jest.mock("@/lib/useFriendRequests", () => ({
  useFriendRequests: () => ({
    data: mockRequestsData,
    refetch: jest.fn(),
  }),
}));

// イベント絞り込み（issue #661）の交換記録。既定は空（絞り込み UI なし）。
let mockExchangeRecordsData: { friendId: string; eventName: string | null }[] =
  [];
jest.mock("@/lib/useExchangeRecords", () => ({
  useExchangeRecords: () => ({
    data: mockExchangeRecordsData,
    refetch: jest.fn(),
  }),
}));

// 届いたお礼の未読件数（issue #694）。既定は 0（未読バナーなし）。
let mockUnreadThanksCount = 0;
jest.mock("@/lib/useFriendThanks", () => ({
  useUnreadThanksCount: () => mockUnreadThanksCount,
  useFriendThanks: () => ({ refetch: jest.fn() }),
}));

jest.mock("@/lib/dialog", () => ({
  confirm: (
    title: string,
    message: string,
    onConfirm: () => void,
    options?: unknown,
  ) => mockConfirm(title, message, onConfirm, options),
  alert: (...args: unknown[]) => mockAlert(...args),
}));

beforeEach(async () => {
  jest.clearAllMocks();
  mockRemoveMutateAsync.mockReset();
  mockFriendsLoading = false;
  mockFriendsError = false;
  mockRequestsData = { received: [], sent: [] };
  mockFriendsData = [mockFriend];
  mockExchangeRecordsData = [];
  mockUnreadThanksCount = 0;
  // 既定は成功扱い（画面側は .catch で失敗だけ拾う）。
  mockRemoveMutateAsync.mockResolvedValue(null);
});

describe("FriendsSection", () => {
  it("初回取得中は一覧のスケルトンを表示する", async () => {
    mockFriendsLoading = true;
    await render(<FriendsSection />);

    expect(screen.getByTestId("list-loading-skeleton")).toBeTruthy();
  });

  it("再取得に失敗しても取得済みのフレンドを表示する", async () => {
    mockFriendsError = true;
    await render(<FriendsSection />);

    expect(screen.getByTestId("friend-card-friend_1")).toBeTruthy();
  });
  it("QR で交換した相手には交換日と「QRで交換」を表示する", async () => {
    await render(<FriendsSection />);

    expect(screen.getByText(/2026年11月10日にQRで交換/)).toBeTruthy();
  });
  it("申請経由で交換した相手には「申請で交換」を表示する", async () => {
    mockFriendsData = [{ ...mockFriend, source: "request" }];
    await render(<FriendsSection />);

    expect(screen.getByText(/2026年11月10日に申請で交換/)).toBeTruthy();
  });
  it("交換経路が不明な相手には交換日だけを表示する", async () => {
    mockFriendsData = [{ ...mockFriend, source: null }];
    await render(<FriendsSection />);

    expect(screen.getByText(/^2026年11月10日に交換$/)).toBeTruthy();
  });
  it("削除ボタンを押すと確認ダイアログ経由で remove が呼ばれる", async () => {
    await render(<FriendsSection />);
    await fireEvent.press(screen.getByLabelText("友達Aをフレンドから削除"));

    expect(mockRemoveMutateAsync).toHaveBeenCalledWith("friend_1");
  });

  it("削除に失敗したらダイアログで通知する", async () => {
    mockRemoveMutateAsync.mockRejectedValue(
      new ApiRequestError(500, "フレンド削除に失敗しました"),
    );
    await render(<FriendsSection />);
    await fireEvent.press(screen.getByLabelText("友達Aをフレンドから削除"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "フレンドを削除できませんでした",
        "フレンドの削除に失敗しました",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });

  it("フレンド行をタップすると相手のプロフィールへ進む", async () => {
    await render(<FriendsSection />);
    await fireEvent.press(screen.getByTestId("friend-item-friend_1"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "friend_1" },
    });
  });

  it("送った申請があると「送ったフレンド申請」に出し、タップで相手のプロフィールへ進む", async () => {
    mockRequestsData = {
      received: [],
      sent: [
        {
          id: 5,
          userId: "addressee_1",
          username: "申請先C",
          bio: null,
          favoriteQuote: null,
          profileImageUrl: null,
        },
      ],
    };
    await render(<FriendsSection />);

    expect(screen.getByText("送ったフレンド申請")).toBeTruthy();
    expect(screen.getByText("フレンド申請中")).toBeTruthy();

    await fireEvent.press(
      screen.getByTestId("sent-friend-request-item-addressee_1"),
    );

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "addressee_1" },
    });
  });

  it("届いた申請と送った申請が両方あると両方のグループを出す", async () => {
    mockRequestsData = {
      received: [
        {
          id: 3,
          userId: "requester_1",
          username: "申請者B",
          bio: null,
          favoriteQuote: null,
          profileImageUrl: null,
        },
      ],
      sent: [
        {
          id: 5,
          userId: "addressee_1",
          username: "申請先C",
          bio: null,
          favoriteQuote: null,
          profileImageUrl: null,
        },
      ],
    };
    await render(<FriendsSection />);

    expect(screen.getByText("届いたフレンド申請")).toBeTruthy();
    expect(screen.getByText("送ったフレンド申請")).toBeTruthy();
  });

  it("届いた申請があると一覧の先頭に出し、タップで相手のプロフィールへ進む", async () => {
    mockRequestsData = {
      received: [
        {
          id: 3,
          userId: "requester_1",
          username: "申請者B",
          bio: null,
          favoriteQuote: null,
          profileImageUrl: null,
        },
      ],
      sent: [],
    };
    await render(<FriendsSection />);

    const row = screen.getByTestId("friend-request-item-requester_1");
    await fireEvent.press(row);

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/user/[uid]",
      params: { uid: "requester_1" },
    });
  });

  it("申請が無ければ申請一覧は出さない", async () => {
    await render(<FriendsSection />);

    expect(screen.queryByText("届いたフレンド申請")).toBeNull();
  });

  it("API エラー以外の失敗では技術メッセージを出さず固定文言に寄せる", async () => {
    mockRemoveMutateAsync.mockRejectedValue(
      new Error("Network request failed"),
    );
    await render(<FriendsSection />);
    await fireEvent.press(screen.getByLabelText("友達Aをフレンドから削除"));

    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith(
        "フレンドを削除できませんでした",
        "フレンドの削除に失敗しました",
        expect.objectContaining({ okLabel: "OK" }),
      ),
    );
  });

  it("記録にイベント名があると絞り込みチップが出て、そのイベントの相手だけに絞れる（issue #661）", async () => {
    mockFriendsData = [
      mockFriend,
      { ...mockFriend, friendId: "user_friend002", username: "友達B" },
    ];
    mockExchangeRecordsData = [
      { friendId: "friend_1", eventName: "コミックマーケット" },
      { friendId: "user_friend002", eventName: null },
    ];
    await render(<FriendsSection />);

    // イベント名のチップと「すべて」が出る
    expect(screen.getByLabelText("コミックマーケット")).toBeTruthy();
    expect(screen.getByLabelText("すべて")).toBeTruthy();

    // 絞り込むとイベントで会った友達Aだけが残り、順序は変えずに間引く
    await fireEvent.press(screen.getByLabelText("コミックマーケット"));
    expect(screen.queryByLabelText("友達Aをフレンドから削除")).toBeTruthy();
    expect(screen.queryByLabelText("友達Bをフレンドから削除")).toBeNull();

    // 同じチップを再度押すと絞り込み解除
    await fireEvent.press(screen.getByLabelText("コミックマーケット"));
    expect(screen.queryByLabelText("友達Bをフレンドから削除")).toBeTruthy();
  });

  it("届いたお礼の未読があると上部に「新しいお礼が N 件」を出し、押すと届いたお礼一覧へ進む（issue #694）", async () => {
    mockUnreadThanksCount = 2;
    await render(<FriendsSection />);

    const banner = screen.getByTestId("unread-thanks-banner");
    expect(screen.getByText("新しいお礼が 2 件")).toBeTruthy();
    await fireEvent.press(banner);
    expect(mockPush).toHaveBeenCalledWith("/thanks");
  });

  it("届いたお礼の未読が 0 なら未読の 1 行は出さない（issue #694）", async () => {
    await render(<FriendsSection />);

    expect(screen.queryByTestId("unread-thanks-banner")).toBeNull();
  });
});
