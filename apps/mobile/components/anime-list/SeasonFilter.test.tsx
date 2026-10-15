import { fireEvent, render } from "@testing-library/react-native";
import { SeasonFilter } from "./SeasonFilter";
import type { SeasonKey } from "./animeListUtils";

// 2026-10-15（秋）に固定する。選択上限は 2027 春（今期+2 シーズン）。
const NOW = new Date(2026, 9, 15);

const renderFilter = (
  props: { year?: number; season?: SeasonKey } = {},
  onChange = jest.fn(),
) => {
  const utils = render(
    <SeasonFilter
      year={props.year ?? 2026}
      season={props.season ?? "autumn"}
      onChange={onChange}
    />,
  );
  return { onChange, ...utils };
};

describe("SeasonFilter", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("選択中の年をピッカーボタンに表示する", () => {
    const { getByTestId, getByText } = renderFilter({ year: 1990 });
    expect(getByTestId("season-filter-year-button")).toBeTruthy();
    expect(getByText("1990年")).toBeTruthy();
  });

  it("年ボタンでピッカーが開き、年を選ぶと onChange が呼ばれて閉じる", () => {
    const { getByTestId, queryByTestId, onChange } = renderFilter();
    fireEvent.press(getByTestId("season-filter-year-button"));
    fireEvent.press(getByTestId("season-filter-year-option-2025"));

    expect(onChange).toHaveBeenCalledWith(2025, "autumn");
    expect(queryByTestId("season-filter-year-option-2025")).toBeNull();
  });

  it("遷移先の年で選択中の期が選べない場合、選べる最後の期に寄せる", () => {
    const { getByTestId, onChange } = renderFilter({
      year: 2026,
      season: "autumn",
    });
    fireEvent.press(getByTestId("season-filter-year-button"));
    fireEvent.press(getByTestId("season-filter-year-option-2027"));

    // 2027 は冬・春しか選べないため、秋は春にクランプされる
    expect(onChange).toHaveBeenCalledWith(2027, "spring");
  });

  it("今期+2 シーズンより先の期チップは無効になる", () => {
    const { getByTestId, onChange } = renderFilter({
      year: 2027,
      season: "winter",
    });

    const summer = getByTestId("season-filter-season-summer");
    expect(summer.props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(summer);
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.press(getByTestId("season-filter-season-spring"));
    expect(onChange).toHaveBeenCalledWith(2027, "spring");
  });

  it("期チップを押すと年を変えずにその期で onChange が呼ばれる", () => {
    const { getByTestId, onChange } = renderFilter();
    fireEvent.press(getByTestId("season-filter-season-winter"));
    expect(onChange).toHaveBeenCalledWith(2026, "winter");
  });
});
