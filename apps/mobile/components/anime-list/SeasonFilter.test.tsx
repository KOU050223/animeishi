import { fireEvent, render } from "@testing-library/react-native";
import { SeasonFilter } from "./SeasonFilter";
import type { SeasonKey } from "./animeListUtils";

// 2026-10-15（秋）に固定する。選択上限は 2027 春（今期+2 シーズン）。
const NOW = new Date(2026, 9, 15);

const renderFilter = async (
  props: { year?: number; season?: SeasonKey } = {},
  onChange = jest.fn(),
) => {
  const utils = await render(
    <SeasonFilter
      year={props.year ?? 2026}
      season={props.season ?? "autumn"}
      onChange={onChange}
    />,
  );
  return { onChange, ...utils };
};

describe("SeasonFilter", () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(async () => {
    jest.useRealTimers();
  });

  it("選択中の年をピッカーボタンに表示する", async () => {
    const { getByTestId, getByText } = await renderFilter({ year: 1990 });
    expect(getByTestId("season-filter-year-button")).toBeTruthy();
    expect(getByText("1990年")).toBeTruthy();
  });

  it("年ボタンでピッカーが開き、年を選ぶと onChange が呼ばれて閉じる", async () => {
    const { getByTestId, queryByTestId, onChange } = await renderFilter();
    await fireEvent.press(getByTestId("season-filter-year-button"));
    await fireEvent.press(getByTestId("season-filter-year-option-2025"));

    expect(onChange).toHaveBeenCalledWith(2025, "autumn");
    expect(queryByTestId("season-filter-year-option-2025")).toBeNull();
  });

  it("遷移先の年で選択中の期が選べない場合、選べる最後の期に寄せる", async () => {
    const { getByTestId, onChange } = await renderFilter({
      year: 2026,
      season: "autumn",
    });
    await fireEvent.press(getByTestId("season-filter-year-button"));
    await fireEvent.press(getByTestId("season-filter-year-option-2027"));

    // 2027 は冬・春しか選べないため、秋は春にクランプされる
    expect(onChange).toHaveBeenCalledWith(2027, "spring");
  });

  it("今期+2 シーズンより先の期チップは無効になる", async () => {
    const { getByTestId, onChange } = await renderFilter({
      year: 2027,
      season: "winter",
    });

    const summer = getByTestId("season-filter-season-summer");
    expect(summer.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(summer);
    expect(onChange).not.toHaveBeenCalled();

    await fireEvent.press(getByTestId("season-filter-season-spring"));
    expect(onChange).toHaveBeenCalledWith(2027, "spring");
  });

  it("期チップを押すと年を変えずにその期で onChange が呼ばれる", async () => {
    const { getByTestId, onChange } = await renderFilter();
    await fireEvent.press(getByTestId("season-filter-season-winter"));
    expect(onChange).toHaveBeenCalledWith(2026, "winter");
  });

  describe("allowAllYear（通年チップ。issue #346）", () => {
    const renderAllYear = async (
      season: "all" | SeasonKey,
      onChange = jest.fn(),
    ) => {
      const utils = await render(
        <SeasonFilter
          year={2026}
          season={season}
          allowAllYear
          onChange={onChange}
        />,
      );
      return { onChange, ...utils };
    };

    it("allowAllYear 無しでは通年チップを出さない", async () => {
      const { queryByTestId } = await renderFilter();
      expect(queryByTestId("season-filter-season-all")).toBeNull();
    });

    it("allowAllYear では先頭に通年チップを出す", async () => {
      const { getByTestId } = await renderAllYear("autumn");
      expect(getByTestId("season-filter-season-all")).toBeTruthy();
    });

    it("通年チップを押すと onChange が (年, all) で呼ばれる", async () => {
      const { getByTestId, onChange } = await renderAllYear("autumn");
      await fireEvent.press(getByTestId("season-filter-season-all"));
      expect(onChange).toHaveBeenCalledWith(2026, "all");
    });

    it("通年選択中に年を変えると期をクランプせず (次年, all) を返す", async () => {
      const { getByTestId, onChange } = await renderAllYear("all");
      await fireEvent.press(getByTestId("season-filter-year-button"));
      await fireEvent.press(getByTestId("season-filter-year-option-2027"));
      // 2027 年は冬・春しか選べないが、通年はどの年でも選べるためそのまま
      expect(onChange).toHaveBeenCalledWith(2027, "all");
    });
  });
});
