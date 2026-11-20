import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { PublicSettingsSection } from "./PublicSettingsSection";
import type { PublicSettingItem } from "./PublicSettingsSection";

const profileItem: PublicSettingItem = {
  key: "profile",
  label: "プロフィールと名刺",
  description:
    "公開にすると、ひろばの「みつける」に名刺が掲載され、共有リンクや名刺の公開画像から誰でもプロフィールを見られるようになります。非公開にするとこれらはすべて見られなくなります",
  visibility: "public",
};

it("一覧の各行をラベル・説明文つきで表示する", async () => {
  await render(
    <PublicSettingsSection
      items={[profileItem]}
      pendingKey={null}
      onChange={jest.fn()}
    />,
  );

  expect(screen.getByText("公開設定")).toBeTruthy();
  expect(screen.getByText("プロフィールと名刺")).toBeTruthy();
  expect(screen.getByText(/ひろばの「みつける」に名刺が掲載され/)).toBeTruthy();
});

it("保存中はすべての行のスイッチを無効にする", async () => {
  await render(
    <PublicSettingsSection
      items={[profileItem]}
      pendingKey="profile"
      onChange={jest.fn()}
    />,
  );

  expect(screen.getByTestId("visibility-profile").props.disabled).toBe(true);
});

it("2 段階の行はスイッチで公開範囲を切り替えられる", async () => {
  const onChange = jest.fn();
  await render(
    <PublicSettingsSection
      items={[profileItem]}
      pendingKey={null}
      onChange={onChange}
    />,
  );

  await fireEvent(
    screen.getByTestId("visibility-profile"),
    "valueChange",
    false,
  );
  expect(onChange).toHaveBeenCalledWith("profile", "private");

  await fireEvent(
    screen.getByTestId("visibility-profile"),
    "valueChange",
    true,
  );
  expect(onChange).toHaveBeenCalledWith("profile", "public");
});
