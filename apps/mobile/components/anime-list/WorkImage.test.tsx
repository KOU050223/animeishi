import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { WorkImage } from "./WorkImage";

// 読み込み中と画像欠落を区別する loadingPlaceholder（issue #606）のテスト。
// expo-image は requireNativeView("ExpoImage") のネイティブビュー。
// RN 0.88 ではレガシー ViewManager が ViewManagerAdapter_ 接頭辞付きの
// ホスト名でマウントされるため、ExpoImage で終わる型名で絞る。
const findImages = () =>
  screen.container.queryAll(
    (node) => typeof node.type === "string" && node.type.endsWith("ExpoImage"),
  );

const HOSTED = "http://localhost:8787/images/works/1";

const missing = <Text>missing</Text>;
const loading = <Text>loading</Text>;

describe("WorkImage の loadingPlaceholder", () => {
  it("読み込み中は loadingPlaceholder、失敗が確定したら placeholder に切り替わる", async () => {
    jest.useFakeTimers();
    try {
      await render(
        <WorkImage
          uri={HOSTED}
          style={{ width: 60, height: 90 }}
          placeholder={missing}
          loadingPlaceholder={loading}
        />,
      );

      // 読み込み中は「読み込み中」の見た目
      expect(screen.getByText("loading")).toBeTruthy();
      expect(screen.queryByText("missing")).toBeNull();

      // 再試行を尽くして失敗が確定したら「画像なし」の見た目に切り替わる
      await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
      expect(screen.getByText("loading")).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      await fireEvent(findImages()[0], "onError", { nativeEvent: {} });

      expect(screen.getByText("missing")).toBeTruthy();
      expect(screen.queryByText("loading")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("URL が無いときは最初から placeholder", async () => {
    await render(
      <WorkImage
        uri={null}
        style={{ width: 60, height: 90 }}
        placeholder={missing}
        loadingPlaceholder={loading}
      />,
    );
    expect(screen.getByText("missing")).toBeTruthy();
    expect(screen.queryByText("loading")).toBeNull();
  });

  it("loadingPlaceholder を省略したときは従来通り placeholder を読み込み中にも出す", async () => {
    await render(
      <WorkImage
        uri={HOSTED}
        style={{ width: 60, height: 90 }}
        placeholder={missing}
      />,
    );
    expect(screen.getByText("missing")).toBeTruthy();
  });
});
