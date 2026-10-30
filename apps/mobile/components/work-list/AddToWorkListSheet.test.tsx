import { fireEvent, render } from "@testing-library/react-native";
import { AddToWorkListSheet } from "./AddToWorkListSheet";

// API 呼び出しは useWorkLists 系フックのテストで検証する。
// シート側は「行の描画と追加・作成の受け渡し」だけを見るため、
// フックは状態ごとに差し替えられるモックにする。
const mockUseWorkListsContaining = jest.fn();
const mockAddMutate = jest.fn();
const mockCreateMutate = jest.fn();
jest.mock("@/lib/workList/useWorkLists", () => ({
  useWorkListsContaining: (...args: unknown[]) =>
    mockUseWorkListsContaining(...args),
  useAddWorkToWorkList: () => ({
    mutate: mockAddMutate,
    isPending: false,
  }),
  useSaveWorkList: () => ({
    mutate: mockCreateMutate,
    isPending: false,
  }),
}));

const mockAlert = jest.fn();
jest.mock("@/lib/dialog", () => ({
  alert: (...args: unknown[]) => mockAlert(...args),
}));

const WORK = { annictWorkId: 42, title: "テストアニメ" };

const LIST_A = {
  id: 1,
  title: "必修アニメリスト",
  itemCount: 3,
  containsWork: false,
};
const LIST_B = {
  id: 2,
  title: "ゆるく周回するアニメ",
  itemCount: 5,
  containsWork: true,
};

type ListsState = {
  data: (typeof LIST_A)[] | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
};

const lists = (overrides: Partial<ListsState> = {}): ListsState => ({
  data: [LIST_A, LIST_B],
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  ...overrides,
});

const sheetElement = (
  props: {
    work?: typeof WORK | null;
    onClose?: jest.Mock;
  } = {},
) => (
  <AddToWorkListSheet
    work={props.work === undefined ? WORK : props.work}
    onClose={props.onClose ?? jest.fn()}
  />
);

describe("AddToWorkListSheet", () => {
  beforeEach(() => {
    mockUseWorkListsContaining.mockReset();
    mockAddMutate.mockReset();
    mockCreateMutate.mockReset();
    mockAlert.mockReset();
    mockUseWorkListsContaining.mockReturnValue(lists());
  });

  it("対象作品の annictWorkId で contains 付き一覧を取る", async () => {
    await render(sheetElement());
    expect(mockUseWorkListsContaining).toHaveBeenCalledWith(42);
  });

  it("work=null（閉じた状態）では一覧を取らない", async () => {
    await render(sheetElement({ work: null }));
    expect(mockUseWorkListsContaining).toHaveBeenCalledWith(null);
  });

  it("未追加のリストをタップすると add.mutate に作品を渡す", async () => {
    const { getByTestId } = await render(sheetElement());

    await fireEvent.press(getByTestId("add-to-work-list-row-1"));

    expect(mockAddMutate).toHaveBeenCalledWith(
      { listId: 1, annictWorkId: 42 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("containsWork のリストは「追加済み」になりタップしても追加しない", async () => {
    const { getByTestId, getByText } = await render(sheetElement());

    expect(getByText("追加済み")).toBeTruthy();
    await fireEvent.press(getByTestId("add-to-work-list-row-2"));
    expect(mockAddMutate).not.toHaveBeenCalled();
  });

  it("追加に成功した行は「追加済み」表示に変わる", async () => {
    mockAddMutate.mockImplementation(
      (
        _input: unknown,
        options: { onSuccess: () => void; onSettled: () => void },
      ) => {
        options.onSuccess();
        options.onSettled();
      },
    );
    const { getByTestId, getAllByText } = await render(sheetElement());

    await fireEvent.press(getByTestId("add-to-work-list-row-1"));

    // LIST_B 分と合わせて 2 件「追加済み」になる
    expect(getAllByText("追加済み")).toHaveLength(2);
  });

  it("追加に失敗したらエラーダイアログを出す", async () => {
    mockAddMutate.mockImplementation(
      (_input: unknown, options: { onError: () => void }) => options.onError(),
    );
    const { getByTestId } = await render(sheetElement());

    await fireEvent.press(getByTestId("add-to-work-list-row-1"));

    expect(mockAlert).toHaveBeenCalledWith(
      "追加に失敗しました",
      "時間をおいて再度お試しください。",
      expect.objectContaining({ okLabel: "OK" }),
    );
  });

  it("「新しいリストを作る」でこの作品だけを入れたリストを作れる", async () => {
    const { getByTestId } = await render(sheetElement());

    await fireEvent.press(getByTestId("add-to-work-list-create"));
    await fireEvent.changeText(
      getByTestId("add-to-work-list-new-title"),
      "新しいリスト",
    );
    await fireEvent.press(getByTestId("add-to-work-list-create-submit"));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      { title: "新しいリスト", items: [{ annictWorkId: 42 }] },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("リストが 0 件なら作成導線の案内を出す", async () => {
    mockUseWorkListsContaining.mockReturnValue(lists({ data: [] }));
    const { getByText, getByTestId } = await render(sheetElement());

    expect(
      getByText(
        "まだリストがありません。「新しいリストを作る」から追加先を作れます",
      ),
    ).toBeTruthy();
    expect(getByTestId("add-to-work-list-create")).toBeTruthy();
  });

  it("一覧の取得エラー時はメッセージと再試行を出す", async () => {
    const refetch = jest.fn();
    mockUseWorkListsContaining.mockReturnValue(
      lists({ data: undefined, isError: true, refetch }),
    );
    const { getByTestId, getByText } = await render(sheetElement());

    expect(getByText("リストを取得できませんでした")).toBeTruthy();
    await fireEvent.press(getByTestId("add-to-work-list-retry"));
    expect(refetch).toHaveBeenCalled();
  });
});
