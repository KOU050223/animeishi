import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ExchangeRecordSheet } from "@/components/social/ExchangeRecordSheet";
import { featureFlags } from "@/lib/featureFlags";
import { useEventList } from "@/features/events/useEvents";

jest.mock("@/features/events/useEvents", () => ({
  useEventList: jest.fn(),
}));

jest.mock("@/lib/exchangePlace", () => ({
  resolvePlaceName: jest.fn(),
}));

const NOW = new Date();
const ongoingEvent = {
  slug: "comiket-107",
  title: "コミックマーケット107",
  coverImageUrl: null,
  location: "東京ビッグサイト",
  startsAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
  endsAt: new Date(NOW.getTime() + 60 * 60 * 1000).toISOString(),
  participating: false,
};

function renderSheet() {
  return render(
    <ExchangeRecordSheet
      visible
      initialPlaceName={null}
      initialEventSlug={null}
      initialEventName={null}
      onClose={jest.fn()}
      onSubmit={jest.fn()}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useEventList).mockReturnValue({
    data: { items: [ongoingEvent] },
  } as unknown as ReturnType<typeof useEventList>);
});

afterEach(() => {
  Object.defineProperty(featureFlags, "events", { value: false });
});

describe("ExchangeRecordSheet のイベント候補（#750）", () => {
  it("イベント機能が無効（既定）なら一覧を取得せず、候補チップも出さない", async () => {
    await renderSheet();

    expect(useEventList).toHaveBeenCalledWith({ enabled: false });
    expect(screen.queryByLabelText("コミックマーケット107")).toBeNull();
    expect(screen.getByPlaceholderText("イベント名を入力")).toBeTruthy();
  });

  it("イベント機能が有効なら開催中の登録イベントを候補に出す", async () => {
    Object.defineProperty(featureFlags, "events", { value: true });
    await renderSheet();

    expect(useEventList).toHaveBeenCalledWith({ enabled: true });
    expect(screen.getByLabelText("コミックマーケット107")).toBeTruthy();
  });
});
