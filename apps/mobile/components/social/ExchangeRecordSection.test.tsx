import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ExchangeRecordSection } from "@/components/social/ExchangeRecordSection";
import {
  useExchangeRecordsForFriend,
  useCreateExchangeRecord,
  useUpdateExchangeRecord,
  useDeleteExchangeRecord,
} from "@/lib/useExchangeRecords";
import { resetAuth } from "@/test-utils/auth";

const FRIEND_ID = "user_friend";

function makeRecord(overrides: Record<string, unknown>) {
  return {
    id: 1,
    friendId: FRIEND_ID,
    source: "qr" as const,
    metAt: "2026-11-20T12:00:00.000Z",
    placeName: null,
    eventSlug: null,
    eventName: null,
    cardSnapshotUrl: null,
    createdAt: "2026-11-20T12:00:00.000Z",
    updatedAt: "2026-11-20T12:00:00.000Z",
    ...overrides,
  };
}

jest.mock("@/lib/useExchangeRecords", () => ({
  useExchangeRecordsForFriend: jest.fn(),
  useCreateExchangeRecord: jest.fn(),
  useUpdateExchangeRecord: jest.fn(),
  useDeleteExchangeRecord: jest.fn(),
}));

// 認証付き画像の取得経路（.native/.web の拡張子分割）はここでは固定値に
// 差し替える。ネイティブ実装は source.headers に Authorization を載せ、
// Web 実装は object URL にする。
jest.mock("@/lib/authenticatedImage", () => ({
  useAuthenticatedImageSource: (uri: string | null | undefined) =>
    uri ? { uri } : null,
}));

// シート自体（Modal・位置解決・イベント候補）の挙動は別テストの責務なので、
// onSubmit を叩くだけのスタブに差し替える。
jest.mock("@/components/social/ExchangeRecordSheet", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { Pressable } =
    jest.requireActual<typeof import("react-native")>("react-native");
  return {
    ExchangeRecordSheet: ({
      visible,
      onSubmit,
    }: {
      visible: boolean;
      onSubmit: (update: {
        placeName: string | null;
        eventSlug: string | null;
        eventName: string | null;
      }) => void;
    }) =>
      visible
        ? React.createElement(Pressable, {
            testID: "record-sheet-submit",
            onPress: () =>
              onSubmit({
                placeName: "渋谷のカフェ",
                eventSlug: null,
                eventName: null,
              }),
          })
        : null,
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const mockCreateMutate = jest.fn();
const mockUpdateMutate = jest.fn();
const mockDeleteMutate = jest.fn();

function mockQueries(records: ReturnType<typeof makeRecord>[]) {
  jest.mocked(useExchangeRecordsForFriend).mockReturnValue({
    data: records,
    isError: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useExchangeRecordsForFriend>);
  jest.mocked(useCreateExchangeRecord).mockReturnValue({
    mutate: mockCreateMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useCreateExchangeRecord>);
  jest.mocked(useUpdateExchangeRecord).mockReturnValue({
    mutate: mockUpdateMutate,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateExchangeRecord>);
  jest.mocked(useDeleteExchangeRecord).mockReturnValue({
    mutateAsync: mockDeleteMutate,
  } as unknown as ReturnType<typeof useDeleteExchangeRecord>);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetAuth();
});

describe("ExchangeRecordSection（issue #661 / #662）", () => {
  it("日付・場所・イベントのタイムラインを出す", async () => {
    mockQueries([
      makeRecord({
        id: 1,
        placeName: "東京ビッグサイト",
        eventName: "コミックマーケット",
      }),
      makeRecord({ id: 2, source: "manual", metAt: "2026-11-21T12:00:00Z" }),
    ]);
    await render(<ExchangeRecordSection uid={FRIEND_ID} />, { wrapper });

    expect(screen.getByTestId("exchange-record-item-1")).toBeTruthy();
    expect(screen.getByTestId("exchange-record-item-2")).toBeTruthy();
    expect(
      screen.getByText("東京ビッグサイト / コミックマーケット"),
    ).toBeTruthy();
  });

  it("「会った記録を追加」で自分だけの手動記録を作る（issue #662）", async () => {
    mockQueries([makeRecord({ id: 1 })]);
    await render(<ExchangeRecordSection uid={FRIEND_ID} />, { wrapper });

    await fireEvent.press(screen.getByTestId("exchange-record-add"));
    await fireEvent.press(screen.getByTestId("record-sheet-submit"));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      {
        friendId: FRIEND_ID,
        record: {
          placeName: "渋谷のカフェ",
          eventSlug: null,
          eventName: null,
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("cardSnapshotUrl のある記録には当時の名刺画像を出す", async () => {
    mockQueries([
      makeRecord({
        id: 1,
        cardSnapshotUrl:
          "https://api.example.com/me/exchange-records/1/snapshot",
      }),
      makeRecord({ id: 2 }),
    ]);
    await render(<ExchangeRecordSection uid={FRIEND_ID} />, { wrapper });

    expect(screen.getByTestId("exchange-record-snapshot-1")).toBeTruthy();
    expect(screen.queryByTestId("exchange-record-snapshot-2")).toBeNull();
  });
});
