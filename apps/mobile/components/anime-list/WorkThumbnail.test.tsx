import { fireEvent, render, screen } from "@testing-library/react-native";
import { WorkThumbnail } from "./WorkThumbnail";

const HOSTED = "https://api.example.com/images/works/1";
const OTHER = "https://api.example.com/images/works/2";

// expo-image は requireNativeView("ExpoImage") のネイティブビュー。
// RN 0.88 ではレガシー ViewManager が ViewManagerAdapter_ 接頭辞付きの
// ホスト名でマウントされるため、ExpoImage で終わる型名で絞る。
// RNTL 14 では UNSAFE_getByType が無いため queryAll でホスト要素を探す。
const findImages = () =>
  screen.container.queryAll(
    (node) => typeof node.type === "string" && node.type.endsWith("ExpoImage"),
  );

describe("WorkThumbnail", () => {
  it("作品画像プロキシの URL を expo-image でディスクキャッシュ付きで表示する", async () => {
    await render(<WorkThumbnail uri={HOSTED} />);
    const image = findImages()[0];
    expect(image.props.source).toEqual([{ uri: HOSTED }]);
    expect(image.props.cachePolicy).toBe("memory-disk");
  });

  it("web でブラウザのネイティブドラッグがジェスチャを奪わないよう draggable=false にする（issue #327）", async () => {
    await render(<WorkThumbnail uri={HOSTED} />);
    expect(findImages()[0].props.draggable).toBe(false);
  });

  it("読み込み中は画像の下にプレースホルダーを敷く", async () => {
    const { getByText } = await render(<WorkThumbnail uri={HOSTED} />);
    expect(findImages()).toHaveLength(1);
    expect(getByText("No img")).toBeTruthy();
  });

  it("読み込みに失敗したら外部 URL を試さずプレースホルダーだけにする", async () => {
    const { getByText } = await render(<WorkThumbnail uri={HOSTED} />);
    await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
    expect(findImages()).toHaveLength(0);
    expect(getByText("No img")).toBeTruthy();
  });

  it("失敗後に URL が変わると読み込みをやり直す", async () => {
    const { rerender } = await render(<WorkThumbnail uri={HOSTED} />);
    await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
    await rerender(<WorkThumbnail uri={OTHER} />);
    expect(findImages()[0].props.source).toEqual([{ uri: OTHER }]);
  });

  it("失敗した URL から別の URL を経て戻ったときも読み込み直す", async () => {
    const { rerender } = await render(<WorkThumbnail uri={HOSTED} />);
    await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
    await rerender(<WorkThumbnail uri={OTHER} />);
    await rerender(<WorkThumbnail uri={HOSTED} />);
    expect(findImages()[0].props.source).toEqual([{ uri: HOSTED }]);
  });

  it("画像 URL が無ければ最初からプレースホルダー", async () => {
    const { getByText } = await render(<WorkThumbnail uri={null} />);
    expect(findImages()).toHaveLength(0);
    expect(getByText("No img")).toBeTruthy();
  });
});
