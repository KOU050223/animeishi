import { fireEvent, render } from "@testing-library/react-native";
import { Image } from "react-native";
import { WorkThumbnail } from "./WorkThumbnail";

const HOSTED = "https://api.example.com/images/works/1/abcdef12.png";
const EXTERNAL = "https://img.example.com/poster.png";
const RESOLVED = "https://s4.anilist.co/1.jpg";

describe("WorkThumbnail", () => {
  it("hostedImageUrl を最初に表示する", () => {
    const { UNSAFE_getByType } = render(
      <WorkThumbnail item={{ hostedImageUrl: HOSTED, imageUrl: EXTERNAL }} />,
    );
    expect(UNSAFE_getByType(Image).props.source.uri).toBe(HOSTED);
  });

  it("hostedImageUrl が失敗すると次候補（imageUrl）へ切り替わる", () => {
    const { UNSAFE_getByType } = render(
      <WorkThumbnail item={{ hostedImageUrl: HOSTED, imageUrl: EXTERNAL }} />,
    );
    fireEvent(UNSAFE_getByType(Image), "onError");
    expect(UNSAFE_getByType(Image).props.source.uri).toBe(EXTERNAL);
  });

  it("候補を順に消費し、全滅したらプレースホルダーに落ちる", () => {
    const { UNSAFE_getByType, UNSAFE_queryByType, getByText } = render(
      <WorkThumbnail
        item={{
          hostedImageUrl: HOSTED,
          imageUrl: EXTERNAL,
          resolvedImageUrl: RESOLVED,
        }}
      />,
    );
    fireEvent(UNSAFE_getByType(Image), "onError");
    expect(UNSAFE_getByType(Image).props.source.uri).toBe(EXTERNAL);
    fireEvent(UNSAFE_getByType(Image), "onError");
    expect(UNSAFE_getByType(Image).props.source.uri).toBe(RESOLVED);
    fireEvent(UNSAFE_getByType(Image), "onError");
    expect(UNSAFE_queryByType(Image)).toBeNull();
    expect(getByText("No img")).toBeTruthy();
  });

  it("候補が変わると試行位置が先頭に戻る", () => {
    const { UNSAFE_getByType, rerender } = render(
      <WorkThumbnail item={{ hostedImageUrl: HOSTED, imageUrl: EXTERNAL }} />,
    );
    fireEvent(UNSAFE_getByType(Image), "onError");
    expect(UNSAFE_getByType(Image).props.source.uri).toBe(EXTERNAL);
    rerender(
      <WorkThumbnail
        item={{
          hostedImageUrl: HOSTED,
          imageUrl: "https://img.example.com/other.png",
        }}
      />,
    );
    expect(UNSAFE_getByType(Image).props.source.uri).toBe(HOSTED);
  });

  it("画像 URL が無ければ最初からプレースホルダー", () => {
    const { UNSAFE_queryByType, getByText } = render(
      <WorkThumbnail item={{ imageUrl: null }} />,
    );
    expect(UNSAFE_queryByType(Image)).toBeNull();
    expect(getByText("No img")).toBeTruthy();
  });
});
