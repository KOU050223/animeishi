// v1.0 で機能フラグにより隠した画面（#750）へ直接遷移したときの表示。
// フラグは既定 false なので、ここでは既定のまま各ルートを描画する。
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import ArticleRoute from "@/app/article/[slug]";
import ArticleListRoute from "@/app/article/index";
import ElectionRoute from "@/app/election/[slug]";
import ElectionListRoute from "@/app/election/index";
import EventRoute from "@/app/event/[slug]";
import EventListRoute from "@/app/event/index";
import { featureFlags } from "@/lib/featureFlags";

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = false;

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
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
  useLocalSearchParams: () => ({ slug: "example" }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanGoBack = false;
});

describe("機能フラグで隠したルート（#750）", () => {
  it("総選挙・イベント・特集記事のフラグは既定で無効", () => {
    expect(featureFlags.elections).toBe(false);
    expect(featureFlags.events).toBe(false);
    expect(featureFlags.articles).toBe(false);
  });

  it.each([
    ["/election", ElectionListRoute],
    ["/election/[slug]", ElectionRoute],
    ["/event", EventListRoute],
    ["/event/[slug]", EventRoute],
    ["/article", ArticleListRoute],
    ["/article/[slug]", ArticleRoute],
  ])("%s に直接遷移すると「現在は利用できません」を出す", async (_, Route) => {
    await render(<Route />);
    expect(screen.getByTestId("feature-unavailable")).toBeTruthy();
    expect(screen.getByText("現在は利用できません")).toBeTruthy();
  });

  it("「ホームへ戻る」でホームに置き換える", async () => {
    await render(<EventRoute />);
    await fireEvent.press(screen.getByTestId("feature-unavailable-home"));
    expect(mockReplace).toHaveBeenCalledWith("/");
  });

  it("遷移履歴が無いとき戻るボタンはホームへ戻す", async () => {
    await render(<ArticleRoute />);
    await fireEvent.press(screen.getByTestId("feature-unavailable-back"));
    expect(mockReplace).toHaveBeenCalledWith("/");
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("遷移履歴があるとき戻るボタンは前の画面へ戻る", async () => {
    mockCanGoBack = true;
    await render(<ElectionRoute />);
    await fireEvent.press(screen.getByTestId("feature-unavailable-back"));
    expect(mockBack).toHaveBeenCalled();
  });
});
