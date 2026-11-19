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

  await fireEvent.press(screen.getByRole("button", { name: "名刺を閉じる" }));
  expect(screen.queryByTestId("profile-meishi-zoom-dialog")).toBeNull();
});

it("Web ではクリックで拡大する案内を表示する", async () => {
  await render(<ProfileMeishiHint />);
  expect(screen.getByText("クリックすると名刺を拡大表示できます")).toBeTruthy();
});
