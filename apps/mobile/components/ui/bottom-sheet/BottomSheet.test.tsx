import { render, screen } from "@testing-library/react-native";
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
});
