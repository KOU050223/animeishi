import React from "react";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ArticleRail } from "@/components/ArticleRail";
import type { ArticleListItem } from "@/features/articles/useArticles";

// API・認証の振る舞いは features/articles/useArticles の結合部なので、ここではフックの
// 戻り値を差し替えてレールの UI 分岐と遷移を検証する。
let mockArticles: { data?: { items: ArticleListItem[] } };
const mockPush = jest.fn();

jest.mock("@/features/articles/useArticles", () => ({
  useLatestArticles: () => mockArticles,
}));

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

// 画像表示はこのテストの対象外。expo-image のモックを避けるため
// 何も描かないスタブに差し替える。
jest.mock("@/components/anime-list/WorkImage", () => ({
  WorkImage: () => null,
}));

function articleItem(
  slug: string,
  overrides: Partial<ArticleListItem> = {},
): ArticleListItem {
  return {
    slug,
    title: `${slug} 記事`,
    coverImageUrl: null,
    publishedAt: "2026-11-01T12:00:00+09:00",
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockArticles = { data: { items: [] } };
});

describe("ArticleRail", () => {
  it("公開中の記事が無いときは何も描かない", async () => {
    await render(<ArticleRail />);
    expect(screen.queryByTestId("article-rail")).toBeNull();
  });

  it("記事をタイトルつきで並べる", async () => {
    mockArticles = {
      data: {
        items: [articleItem("autumn-2026"), articleItem("interview")],
      },
    };
    await render(<ArticleRail />);
    expect(screen.getByTestId("article-card-autumn-2026")).toBeTruthy();
    expect(screen.getByText("autumn-2026 記事")).toBeTruthy();
    expect(screen.getByText("interview 記事")).toBeTruthy();
  });

  it("カードをタップすると記事詳細へ遷移する", async () => {
    mockArticles = { data: { items: [articleItem("autumn-2026")] } };
    await render(<ArticleRail />);
    await fireEvent.press(screen.getByTestId("article-card-autumn-2026"));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/article/[slug]",
      params: { slug: "autumn-2026" },
    });
  });

  it("「すべて見る」をタップすると記事一覧へ遷移する", async () => {
    mockArticles = { data: { items: [articleItem("autumn-2026")] } };
    await render(<ArticleRail />);
    await fireEvent.press(screen.getByTestId("article-rail-see-all"));
    expect(mockPush).toHaveBeenCalledWith("/article");
  });
});
