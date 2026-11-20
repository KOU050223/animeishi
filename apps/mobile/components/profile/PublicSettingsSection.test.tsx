import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PublicSettingsSection } from "./PublicSettingsSection";

it("名刺、作品リスト、各 Tier 表の公開状態を一覧して切り替えられる", async () => {
  const onToggle = jest.fn();
  await render(
    <PublicSettingsSection
      profilePublic={true}
      items={[
        {
          key: "work-1",
          kind: "work",
          id: "1",
          title: "好きな作品",
          isPublic: false,
        },
        {
          key: "season-2026-spring",
          kind: "season",
          id: "2026-spring",
          title: "春",
          isPublic: true,
        },
        {
          key: "character-2",
          kind: "character",
          id: "2",
          title: "キャラ",
          isPublic: false,
        },
        {
          key: "custom-3",
          kind: "custom",
          id: "3",
          title: "自由",
          isPublic: false,
        },
      ]}
      pendingKey={null}
      onToggle={onToggle}
    />,
  );
  expect(screen.getByText("公開設定")).toBeTruthy();
  expect(screen.getByText("名刺・プロフィール")).toBeTruthy();
  expect(screen.getByText("好きな作品")).toBeTruthy();
  expect(screen.getByText("春")).toBeTruthy();
  expect(screen.getByText("キャラ")).toBeTruthy();
  expect(screen.getByText("自由")).toBeTruthy();
  fireEvent(screen.getByTestId("visibility-profile"), "valueChange", false);
  expect(onToggle).toHaveBeenCalledWith("profile", "", false);
  fireEvent(screen.getByTestId("visibility-work-1"), "valueChange", true);
  expect(onToggle).toHaveBeenCalledWith("work", "1", true);
});
