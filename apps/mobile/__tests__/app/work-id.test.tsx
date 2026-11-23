// 作品ページ（/work/[id]）のテスト。作品詳細シートの「作品ページを見る」
// から遷移する先で、シートと同じ作品情報をスタッフ・キャスト全件で出す。
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";
import WorkScreen from "@/app/work/[id]";

const mockUseWorkDetail = jest.fn();
const mockUseWorkCatalogAccess = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockParams: { id?: string } = { id: "42" };

jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: any) => {
      const { Text } = require("react-native");
      return (
        <>
          {options?.headerLeft ? options.headerLeft({}) : null}
          {options?.title ? <Text>{options.title}</Text> : null}
        </>
      );
    },
  },
  useRouter: () => ({
    push: mockPush,
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => true,
  }),
  useLocalSearchParams: () => mockParams,
}));

jest.mock("@/lib/useWorkDetail", () => ({
  useWorkDetail: (...args: unknown[]) => mockUseWorkDetail(...args),
}));

jest.mock("@/lib/annict", () => ({
  useWorkCatalogAccess: () => mockUseWorkCatalogAccess(),
}));

jest.mock("@/components/AnnictSoftGate", () => ({
  AnnictSoftGate: ({ testID }: { testID?: string }) => {
    const { View } = require("react-native");
    return <View testID={testID} />;
  },
}));

const CASTS = Array.from({ length: 12 }, (_, i) => ({
  annictCastId: 900 + i,
  annictPersonId: 300 + i,
  personName: `声優${i + 1}`,
  characterName: `キャラ${i + 1}`,
}));

const DETAIL = {
  work: {
    annictWorkId: 42,
    nodeId: "n42",
    state: null,
    title: "テストアニメ",
    titleKana: null,
    titleEn: "Test Anime",
    titleRo: null,
    seasonName: "2026-spring",
    seasonYear: 2026,
    imageUrl: null,
    resolvedImageUrl: null,
    hostedImageUrl: "https://api.example/images/works/42",
    malAnimeId: 1234,
    media: "TV",
    episodesCount: 12,
    noEpisodes: false,
    watchersCount: 5432,
    reviewsCount: 3,
    satisfactionRate: 87.5,
    officialSiteUrl: "https://example.com/official",
    officialSiteUrlEn: null,
    wikipediaUrl: null,
    wikipediaUrlEn: null,
    twitterUsername: null,
    twitterHashtag: null,
    staffs: [
      {
        annictStaffId: 501,
        name: "山田 監督",
        role: "監督",
        resource: { kind: "person", annictId: 101 },
      },
      {
        annictStaffId: 503,
        name: "佐藤 作画",
        role: "作画監督",
        resource: { kind: "person", annictId: 103 },
      },
    ],
    casts: CASTS,
  },
};

function detailState(overrides: Record<string, unknown> = {}) {
  return {
    data: DETAIL,
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: "42" };
  mockUseWorkCatalogAccess.mockReturnValue({
    canBrowseWorks: true,
    isLoading: false,
  });
  mockUseWorkDetail.mockReturnValue(detailState());
});

describe("WorkScreen", () => {
  it("URL の作品 ID で詳細を取得し、タイトル・話数・視聴者数・レビュー数を表示する", async () => {
    await render(<WorkScreen />);

    expect(mockUseWorkDetail).toHaveBeenCalledWith(42);
    expect(screen.getAllByText("テストアニメ").length).toBeGreaterThan(0);
    expect(screen.getByText("Test Anime")).toBeTruthy();
    expect(screen.getByText("全12話")).toBeTruthy();
    expect(screen.getByText("3 件")).toBeTruthy();
  });

  it("スタッフ・キャストを折りたたまずに全件表示する", async () => {
    await render(<WorkScreen />);

    // シートでは「もっと見る」に隠れる主要役職以外のスタッフと
    // 11 人目以降のキャストも最初から出す。
    expect(screen.getByText("作画監督：佐藤 作画")).toBeTruthy();
    expect(screen.getByText("声優12（キャラ12）")).toBeTruthy();
  });

  it("Annict の作品ページは外部リンクの一つとして開ける", async () => {
    const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    await render(<WorkScreen />);

    await fireEvent.press(screen.getByLabelText("Annict で見る"));

    expect(openURL).toHaveBeenCalledWith("https://annict.com/works/42");
  });

  it("シーズンチップから同じシーズンの作品一覧へ移る", async () => {
    await render(<WorkScreen />);

    await fireEvent.press(screen.getByTestId("work-detail-season-chip"));

    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/(tabs)/library",
      params: {
        section: "anime",
        season: "2026-spring",
        nav: expect.any(String),
      },
    });
  });

  it("数値でない ID では作品を取得せず表示できない旨を出す", async () => {
    mockParams = { id: "abc" };
    await render(<WorkScreen />);

    expect(screen.getByTestId("work-page-not-found")).toBeTruthy();
    expect(mockUseWorkDetail).toHaveBeenCalledWith(null);
  });

  it("作品情報を取得できないとき（未連携・共用トークンなし）は連携導線を出す", async () => {
    mockUseWorkCatalogAccess.mockReturnValue({
      canBrowseWorks: false,
      isLoading: false,
    });
    await render(<WorkScreen />);

    expect(screen.getByTestId("work-page-soft-gate")).toBeTruthy();
  });

  it("戻るボタンで前の画面へ戻る", async () => {
    await render(<WorkScreen />);

    await fireEvent.press(screen.getByTestId("work-page-back"));

    expect(mockBack).toHaveBeenCalled();
  });
});
