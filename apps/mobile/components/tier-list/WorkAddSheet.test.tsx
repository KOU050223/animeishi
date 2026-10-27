import { fireEvent, render } from "@testing-library/react-native";
import { WorkAddSheet } from "./WorkAddSheet";
import type { TierItem } from "@/lib/tierList/types";

// 実際の検索（API / Annict 連携 / デバウンス）は useWorkSearch のテストで
// 検証する。シート側は「結果の描画と追加の受け渡し」だけを見るため、
// フックは状態ごとに差し替えられるモックにする。
const mockUseWorkSearch = jest.fn();
jest.mock("@/lib/tierList/useWorkSearch", () => ({
  useWorkSearch: (...args: unknown[]) => mockUseWorkSearch(...args),
}));

const RESULT_WORK = {
  annictWorkId: 42,
  nodeId: "n42",
  state: null,
  title: "劇場版テスト",
  titleKana: null,
  titleEn: null,
  seasonYear: 2020,
  seasonName: "2020-autumn",
  imageUrl: null,
  resolvedImageUrl: null,
  hostedImageUrl: "https://api.example/images/works/42",
  malAnimeId: null,
};

type SearchState = {
  works: (typeof RESULT_WORK)[];
  hasQuery: boolean;
  hasMore: boolean;
  isFetching: boolean;
  isError: boolean;
  resultsStale: boolean;
  refetch: jest.Mock;
};

const searching = (overrides: Partial<SearchState> = {}): SearchState => ({
  works: [],
  hasQuery: true,
  hasMore: false,
  isFetching: false,
  isError: false,
  resultsStale: false,
  refetch: jest.fn(),
  ...overrides,
});

const sheetElement = (
  props: {
    visible?: boolean;
    onAdd?: jest.Mock;
    existingWorkIds?: ReadonlySet<number>;
  } = {},
) => (
  <WorkAddSheet
    visible={props.visible ?? true}
    onClose={jest.fn()}
    onAdd={props.onAdd ?? jest.fn()}
    existingWorkIds={props.existingWorkIds ?? new Set()}
  />
);

describe("WorkAddSheet", () => {
  beforeEach(() => {
    mockUseWorkSearch.mockReset();
    mockUseWorkSearch.mockReturnValue(searching({ works: [RESULT_WORK] }));
  });

  it("検索結果の作品をタップすると onAdd に TierItem で渡る", () => {
    const onAdd = jest.fn();
    const { getByTestId } = render(sheetElement({ onAdd }));

    fireEvent.press(getByTestId("work-add-item-42"));

    expect(onAdd).toHaveBeenCalledWith<[TierItem]>({
      id: 42,
      title: "劇場版テスト",
      // 盤面には作品画像プロキシの URL だけを渡す（issue #224）
      imageUrl: "https://api.example/images/works/42",
    });
  });

  it("盤面に既にある作品は「追加済み」になりタップしても onAdd されない", () => {
    const onAdd = jest.fn();
    const { getByTestId, getByText } = render(
      sheetElement({ onAdd, existingWorkIds: new Set([42]) }),
    );

    expect(getByText("追加済み")).toBeTruthy();
    fireEvent.press(getByTestId("work-add-item-42"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("前の語の結果を仮表示している間（resultsStale）は追加ボタンが無効", () => {
    const onAdd = jest.fn();
    mockUseWorkSearch.mockReturnValue(
      searching({ works: [RESULT_WORK], resultsStale: true }),
    );
    const { getByTestId } = render(sheetElement({ onAdd }));

    const item = getByTestId("work-add-item-42");
    expect(item.props.accessibilityState.disabled).toBe(true);
    fireEvent.press(item);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("検索語が空のときは結果ではなく入力案内を出す", () => {
    mockUseWorkSearch.mockReturnValue(searching({ hasQuery: false }));
    const { getByText } = render(sheetElement());
    expect(getByText("追加する作品のタイトルを入力してください")).toBeTruthy();
  });

  it("結果が 0 件なら「見つかりませんでした」を出す", () => {
    mockUseWorkSearch.mockReturnValue(searching({ works: [] }));
    const { getByText } = render(sheetElement());
    expect(getByText("見つかりませんでした")).toBeTruthy();
  });

  it("エラー時はメッセージと再試行ボタンを出し、再試行で refetch を呼ぶ", () => {
    const refetch = jest.fn();
    mockUseWorkSearch.mockReturnValue(searching({ isError: true, refetch }));
    const { getByTestId, getByText } = render(sheetElement());
    expect(getByText("検索に失敗しました")).toBeTruthy();
    fireEvent.press(getByTestId("work-add-retry"));
    expect(refetch).toHaveBeenCalled();
  });

  // 検索語のリセットはレンダー中の状態調整で行う（#267）
  it("閉じて開き直すと検索語がクリアされる", () => {
    const { getByTestId, rerender } = render(sheetElement());
    fireEvent.changeText(getByTestId("work-add-input"), "テスト");
    expect(getByTestId("work-add-input").props.value).toBe("テスト");

    rerender(sheetElement({ visible: false }));
    rerender(sheetElement({ visible: true }));

    expect(getByTestId("work-add-input").props.value).toBe("");
  });

  it("visible=false のとき検索 UI を描画せず、検索も無効化する", () => {
    const { queryByTestId } = render(sheetElement({ visible: false }));
    expect(queryByTestId("work-add-input")).toBeNull();
    // 閉じている間はフック側へ enabled=false として渡す
    expect(mockUseWorkSearch).toHaveBeenLastCalledWith("", false);
  });
});
