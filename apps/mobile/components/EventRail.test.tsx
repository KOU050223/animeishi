import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { EventRail } from "@/components/EventRail";
import type { EventListItem } from "@/lib/useEvents";

// API・認証の振る舞いは lib/useEvents の結合部なので、ここではフックの
// 戻り値を差し替えてレールの UI 分岐と遷移を検証する。
let mockEvents: { data?: { items: EventListItem[] } };
const mockPush = jest.fn();

jest.mock("@/lib/useEvents", () => ({
  useEvents: () => mockEvents,
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// 画像表示はこのテストの対象外。expo-image のモックを避けるため
// 何も描かないスタブに差し替える。
jest.mock("@/components/anime-list/WorkImage", () => ({
  WorkImage: () => null,
}));

function eventItem(
  slug: string,
  overrides: Partial<EventListItem> = {},
): EventListItem {
  return {
    slug,
    title: `${slug} イベント`,
    coverImageUrl: null,
    location: null,
    startsAt: "2026-12-20T10:00:00+09:00",
    endsAt: "2026-12-21T16:00:00+09:00",
    participating: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockEvents = { data: { items: [] } };
});

describe("EventRail", () => {
  it("公開中のイベントが無いときは何も描かない", async () => {
    await render(<EventRail />);
    expect(screen.queryByTestId("event-rail")).toBeNull();
  });

  it("イベントをタイトルと会期つきで並べる", async () => {
    mockEvents = {
      data: {
        items: [eventItem("comiket"), eventItem("animejapan")],
      },
    };
    await render(<EventRail />);
    expect(screen.getByTestId("event-card-comiket")).toBeTruthy();
    expect(screen.getByText("comiket イベント")).toBeTruthy();
    expect(
      screen.getAllByText("2026年12月20日(日)〜12月21日(月)"),
    ).toHaveLength(2);
  });

  it("参加予定・開催中のバッジを出す", async () => {
    mockEvents = {
      data: {
        items: [
          eventItem("comiket", { participating: true }),
          // 開催中のイベント
          eventItem("animejapan", {
            startsAt: "2020-01-01T10:00:00+09:00",
            endsAt: "2099-01-01T16:00:00+09:00",
          }),
        ],
      },
    };
    await render(<EventRail />);
    expect(screen.getByTestId("event-participating-comiket")).toBeTruthy();
    expect(screen.getByTestId("event-ongoing-animejapan")).toBeTruthy();
    expect(screen.queryByTestId("event-ongoing-comiket")).toBeNull();
  });

  it("カードをタップするとイベント詳細へ遷移する", async () => {
    mockEvents = { data: { items: [eventItem("comiket")] } };
    await render(<EventRail />);
    await fireEvent.press(screen.getByTestId("event-card-comiket"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/event/[slug]",
      params: { slug: "comiket" },
    });
  });
});
