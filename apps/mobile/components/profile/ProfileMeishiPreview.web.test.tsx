import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ProfileMeishiPreview } from "./ProfileMeishiPreview.web";
import { ProfileMeishiHint } from "./ProfileMeishiHint.web";

jest.mock("@/components/MeishiCard", () => ({
  MeishiCard: () => {
    const { Text } = require("react-native");
    return <Text>名刺</Text>;
  },
}));

it("Web の名刺はクリックで全体を拡大表示し、閉じられる", async () => {
  await render(<ProfileMeishiPreview username="テスト" />);

  const preview = screen.getByRole("button", { name: "名刺を拡大" });
  expect(screen.queryByTestId("profile-meishi-zoom-dialog")).toBeNull();

  await fireEvent.press(preview);
  expect(screen.getByTestId("profile-meishi-zoom-dialog")).toBeTruthy();
  expect(screen.getAllByText("名刺")).toHaveLength(2);

  // 背景の backdrop と閉じるボタンの両方が「名刺を閉じる」で読み上げられ、
  // どちらの操作でも閉じられる。閉じて開き直すと要素が作り直されるため、
  // 各回で取り直して押す。
  const findCloseControls = () =>
    screen.getAllByRole("button", { name: "名刺を閉じる" });
  expect(findCloseControls()).toHaveLength(2);
  for (const index of [0, 1]) {
    const control = findCloseControls().at(index);
    expect(control).toBeTruthy();
    if (!control) return;
    await fireEvent.press(control);
    expect(screen.queryByTestId("profile-meishi-zoom-dialog")).toBeNull();
    await fireEvent.press(preview);
    expect(screen.getByTestId("profile-meishi-zoom-dialog")).toBeTruthy();
  }
});

it("Web ではクリックで拡大する案内を表示する", async () => {
  await render(<ProfileMeishiHint />);
  expect(screen.getByText("クリックすると名刺を拡大表示できます")).toBeTruthy();
});
