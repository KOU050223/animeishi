import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ElectionRail } from "@/components/ElectionRail";
import type { ElectionListItem } from "@/lib/useElections";

// API・認証の振る舞いは lib/useElections の結合部なので、ここではフックの
// 戻り値を差し替えてレールの UI 分岐と遷移を検証する。
let mockElections: { data?: { items: ElectionListItem[] } };
const mockPush = jest.fn();

jest.mock("@/lib/useElections", () => ({
  useElections: () => mockElections,
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// 画像表示はこのテストの対象外。expo-image のモックを避けるため
// 何も描かないスタブに差し替える。
jest.mock("@/components/anime-list/WorkImage", () => ({
  WorkImage: () => null,
}));

function electionItem(
  slug: string,
  overrides: Partial<ElectionListItem> = {},
): ElectionListItem {
  return {
    slug,
    title: `${slug} 総選挙`,
    coverImageUrl: null,
    startsAt: "2026-11-10T10:00:00+09:00",
    endsAt: "2026-11-20T18:00:00+09:00",
    voted: false,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockElections = { data: { items: [] } };
});

describe("ElectionRail", () => {
  it("公開中の総選挙が無いときは何も描かない", async () => {
    await render(<ElectionRail />);
    expect(screen.queryByTestId("election-rail")).toBeNull();
  });

  it("総選挙をタイトルと期間つきで並べる", async () => {
    mockElections = {
      data: {
        items: [electionItem("megane"), electionItem("heroine")],
      },
    };
    await render(<ElectionRail />);
    expect(screen.getByTestId("election-card-megane")).toBeTruthy();
    expect(screen.getByText("megane 総選挙")).toBeTruthy();
    expect(
      screen.getAllByText("2026年11月10日(火)〜11月20日(金)"),
    ).toHaveLength(2);
  });

  it("投票済み・投票受付中のバッジを出す", async () => {
    mockElections = {
      data: {
        items: [
          // 終了済みの総選挙。期間を固定の過去日にして現在日時への依存を避ける
          electionItem("megane", {
            voted: true,
            startsAt: "2020-01-01T10:00:00+09:00",
            endsAt: "2020-01-10T18:00:00+09:00",
          }),
          // 投票受付中の総選挙
          electionItem("heroine", {
            startsAt: "2020-01-01T10:00:00+09:00",
            endsAt: "2099-01-01T16:00:00+09:00",
          }),
        ],
      },
    };
    await render(<ElectionRail />);
    expect(screen.getByTestId("election-voted-megane")).toBeTruthy();
    expect(screen.getByTestId("election-voting-heroine")).toBeTruthy();
    expect(screen.queryByTestId("election-voting-megane")).toBeNull();
  });

  it("カードをタップすると総選挙詳細へ遷移する", async () => {
    mockElections = { data: { items: [electionItem("megane")] } };
    await render(<ElectionRail />);
    await fireEvent.press(screen.getByTestId("election-card-megane"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/election/[slug]",
      params: { slug: "megane" },
    });
  });
});
