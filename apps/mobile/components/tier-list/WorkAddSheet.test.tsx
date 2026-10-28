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
  beforeEach(async () => {
    mockUseWorkSearch.mockReset();
    mockUseWorkSearch.mockReturnValue(searching({ works: [RESULT_WORK] }));
  });

  it("検索結果の作品をタップすると onAdd に TierItem で渡る", async () => {
    const onAdd = jest.fn();
    const { getByTestId } = await render(sheetElement({ onAdd }));

    await fireEvent.press(getByTestId("work-add-item-42"));

    expect(onAdd).toHaveBeenCalledWith<[TierItem]>({
      id: 42,
      title: "劇場版テスト",
      // 盤面には作品画像プロキシの URL だけを渡す（issue #224）
      imageUrl: "https://api.example/images/works/42",
    });
  });

  it("盤面に既にある作品は「追加済み」になりタップしても onAdd されない", async () => {
    const onAdd = jest.fn();
    const { getByTestId, getByText } = await render(
      sheetElement({ onAdd, existingWorkIds: new Set([42]) }),
    );

    expect(getByText("追加済み")).toBeTruthy();
    await fireEvent.press(getByTestId("work-add-item-42"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("前の語の結果を仮表示している間（resultsStale）は追加ボタンが無効", async () => {
    const onAdd = jest.fn();
    mockUseWorkSearch.mockReturnValue(
      searching({ works: [RESULT_WORK], resultsStale: true }),
    );
    const { getByTestId } = await render(sheetElement({ onAdd }));

    const item = getByTestId("work-add-item-42");
    expect(item.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(item);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("検索語が空のときは結果ではなく入力案内を出す", async () => {
    mockUseWorkSearch.mockReturnValue(searching({ hasQuery: false }));
    const { getByText } = await render(sheetElement());
    expect(getByText("追加する作品のタイトルを入力してください")).toBeTruthy();
  });

  it("結果が 0 件なら「見つかりませんでした」を出す", async () => {
    mockUseWorkSearch.mockReturnValue(searching({ works: [] }));
    const { getByText } = await render(sheetElement());
    expect(getByText("見つかりませんでした")).toBeTruthy();
  });

  it("エラー時はメッセージと再試行ボタンを出し、再試行で refetch を呼ぶ", async () => {
    const refetch = jest.fn();
    mockUseWorkSearch.mockReturnValue(searching({ isError: true, refetch }));
    const { getByTestId, getByText } = await render(sheetElement());
    expect(getByText("検索に失敗しました")).toBeTruthy();
    await fireEvent.press(getByTestId("work-add-retry"));
    expect(refetch).toHaveBeenCalled();
  });

  // 検索語のリセットはレンダー中の状態調整で行う（#267）
  it("閉じて開き直すと検索語がクリアされる", async () => {
    const { getByTestId, rerender } = await render(sheetElement());
    await fireEvent.changeText(getByTestId("work-add-input"), "テスト");
    expect(getByTestId("work-add-input").props.value).toBe("テスト");

    await rerender(sheetElement({ visible: false }));
    await rerender(sheetElement({ visible: true }));

    expect(getByTestId("work-add-input").props.value).toBe("");
  });

  it("visible=false のとき検索 UI を描画せず、検索も無効化する", async () => {
    const { queryByTestId } = await render(sheetElement({ visible: false }));
    expect(queryByTestId("work-add-input")).toBeNull();
    // 閉じている間はフック側へ enabled=false として渡す
    expect(mockUseWorkSearch).toHaveBeenLastCalledWith("", false);
  });
});
