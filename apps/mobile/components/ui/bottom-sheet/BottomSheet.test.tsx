import { render, screen, within } from "@testing-library/react-native";
import { Text } from "react-native";
import { BottomSheet } from "./BottomSheet";

describe("BottomSheet", () => {
  it("visible のとき children を表示する", async () => {
    await render(
      <BottomSheet visible onClose={jest.fn()}>
        <Text>シートの内容</Text>
      </BottomSheet>,
    );
    expect(screen.getByText("シートの内容")).toBeTruthy();
  });

  it("visible でないとき children を表示しない", async () => {
    await render(
      <BottomSheet visible={false} onClose={jest.fn()}>
        <Text>シートの内容</Text>
      </BottomSheet>,
    );
    expect(screen.queryByText("シートの内容")).toBeNull();
  });

  it("children を RNHostView 経由でホストする（直置きだとシート内のタッチが届かない）", async () => {
    await render(
      <BottomSheet visible onClose={jest.fn()}>
        <Text>シートの内容</Text>
      </BottomSheet>,
    );
    // mock 中 RNHostView 渲染为带 testID="expo-ui-rn-host" 的 View，
    // 这里断言 sheet 内容确实被包在其中。
    expect(
      within(screen.getByTestId("expo-ui-rn-host")).getByText("シートの内容"),
    ).toBeTruthy();
  });
});
