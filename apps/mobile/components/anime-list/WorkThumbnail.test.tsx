import { fireEvent, render } from "@testing-library/react-native";
import { Image } from "expo-image";
import { WorkThumbnail } from "./WorkThumbnail";

const HOSTED = "https://api.example.com/images/works/1";
const OTHER = "https://api.example.com/images/works/2";

describe("WorkThumbnail", () => {
  it("作品画像プロキシの URL を expo-image でディスクキャッシュ付きで表示する", () => {
    const { UNSAFE_getByType } = render(<WorkThumbnail uri={HOSTED} />);
    const image = UNSAFE_getByType(Image);
    expect(image.props.source.uri).toBe(HOSTED);
    expect(image.props.cachePolicy).toBe("memory-disk");
  });

  it("読み込み中は画像の下にプレースホルダーを敷く", () => {
    const { UNSAFE_getByType, getByText } = render(
      <WorkThumbnail uri={HOSTED} />,
    );
    expect(UNSAFE_getByType(Image)).toBeTruthy();
    expect(getByText("No img")).toBeTruthy();
  });

  it("読み込みに失敗したら外部 URL を試さずプレースホルダーだけにする", () => {
    const { UNSAFE_getByType, UNSAFE_queryByType, getByText } = render(
      <WorkThumbnail uri={HOSTED} />,
    );
    fireEvent(UNSAFE_getByType(Image), "onError");
    expect(UNSAFE_queryByType(Image)).toBeNull();
    expect(getByText("No img")).toBeTruthy();
  });

  it("失敗後に URL が変わると読み込みをやり直す", () => {
    const { UNSAFE_getByType, rerender } = render(
      <WorkThumbnail uri={HOSTED} />,
    );
    fireEvent(UNSAFE_getByType(Image), "onError");
    rerender(<WorkThumbnail uri={OTHER} />);
    expect(UNSAFE_getByType(Image).props.source.uri).toBe(OTHER);
  });

  it("失敗した URL から別の URL を経て戻ったときも読み込み直す", () => {
    const { UNSAFE_getByType, rerender } = render(
      <WorkThumbnail uri={HOSTED} />,
    );
    fireEvent(UNSAFE_getByType(Image), "onError");
    rerender(<WorkThumbnail uri={OTHER} />);
    rerender(<WorkThumbnail uri={HOSTED} />);
    expect(UNSAFE_getByType(Image).props.source.uri).toBe(HOSTED);
  });

  it("画像 URL が無ければ最初からプレースホルダー", () => {
    const { UNSAFE_queryByType, getByText } = render(
      <WorkThumbnail uri={null} />,
    );
    expect(UNSAFE_queryByType(Image)).toBeNull();
    expect(getByText("No img")).toBeTruthy();
  });
});
