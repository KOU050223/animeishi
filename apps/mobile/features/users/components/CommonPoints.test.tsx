import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { CommonPoints } from "./CommonPoints";
import { useCommonPoints } from "@/features/users/useCommonPoints";

jest.mock("@/features/users/useCommonPoints", () => ({
  useCommonPoints: jest.fn(),
}));

const work = {
  annictWorkId: 1,
  title: "共通の作品",
  hostedImageUrl: "https://example.com/1.jpg",
};

it("共有する視聴中・視聴済み・推しを優先順に表示する", async () => {
  jest.mocked(useCommonPoints).mockReturnValue({
    data: {
      watchingTogether: [work],
      watchedTogetherCount: 2,
      favoriteTogether: [work],
      conversationStarters: [],
    },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useCommonPoints>);
  await render(<CommonPoints uid="friend" />);
  expect(screen.getByText("共通点")).toBeTruthy();
  expect(screen.getByText("今期どちらも見ている作品")).toBeTruthy();
  expect(screen.getByText("2作品をどちらも視聴済み")).toBeTruthy();
  expect(screen.getByText("好きな作品が同じ")).toBeTruthy();
  expect(screen.queryByText("話のきっかけ")).toBeNull();
});

it("共通点がないときだけ相手の今期作品を表示する", async () => {
  jest.mocked(useCommonPoints).mockReturnValue({
    data: {
      watchingTogether: [],
      watchedTogetherCount: 0,
      favoriteTogether: [],
      conversationStarters: [work],
    },
    isPending: false,
    isError: false,
    refetch: jest.fn(),
  } as unknown as ReturnType<typeof useCommonPoints>);
  await render(<CommonPoints uid="friend" />);
  expect(screen.getByText("話のきっかけ")).toBeTruthy();
  expect(screen.getByText("共通の作品")).toBeTruthy();
});

it("取得に失敗したら控えめな再試行導線を表示する", async () => {
  const refetch = jest.fn();
  jest.mocked(useCommonPoints).mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    refetch,
  } as unknown as ReturnType<typeof useCommonPoints>);
  await render(<CommonPoints uid="friend" />);
  await fireEvent.press(screen.getByText("共通点を再読み込み"));
  expect(refetch).toHaveBeenCalled();
});
