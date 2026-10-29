import { fireEvent, render, screen } from "@testing-library/react-native";
import { GroupedList } from "./GroupedList";

describe("GroupedList", () => {
  it("セクション見出しと行のラベルを表示する", async () => {
    await render(
      <GroupedList
        sections={[
          {
            key: "about",
            title: "このアプリについて",
            rows: [
              {
                key: "changelog",
                label: "機能一覧・更新情報",
                onPress: jest.fn(),
                accessibilityLabel: "機能一覧・更新情報を開く",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("このアプリについて")).toBeTruthy();
    expect(screen.getByText("機能一覧・更新情報")).toBeTruthy();
  });

  it("行を押すと onPress が呼ばれる", async () => {
    const onPress = jest.fn();
    await render(
      <GroupedList
        sections={[
          {
            key: "legal",
            title: "法務情報",
            rows: [
              {
                key: "terms",
                label: "利用規約",
                onPress,
                accessibilityLabel: "利用規約を開く",
              },
            ],
          },
        ]}
      />,
    );

    await fireEvent.press(screen.getByLabelText("利用規約を開く"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("複数セクションを渡すとすべて表示される", async () => {
    await render(
      <GroupedList
        sections={[
          {
            key: "a",
            title: "分析",
            rows: [
              {
                key: "a1",
                label: "行 A",
                onPress: jest.fn(),
                accessibilityLabel: "行 A を開く",
              },
            ],
          },
          {
            key: "b",
            title: "法務情報",
            rows: [
              {
                key: "b1",
                label: "行 B",
                onPress: jest.fn(),
                accessibilityLabel: "行 B を開く",
              },
            ],
          },
        ]}
      />,
    );

    expect(screen.getByText("分析")).toBeTruthy();
    expect(screen.getByText("法務情報")).toBeTruthy();
    expect(screen.getByText("行 A")).toBeTruthy();
    expect(screen.getByText("行 B")).toBeTruthy();
  });
});
