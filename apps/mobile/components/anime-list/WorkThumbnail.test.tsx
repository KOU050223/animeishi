import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { WorkThumbnail } from "./WorkThumbnail";

const HOSTED = "https://api.example.com/images/works/1";
const OTHER = "https://api.example.com/images/works/2";
const TITLE = "銀河鉄道の夜";

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
    await render(<WorkThumbnail uri={HOSTED} title={TITLE} />);
    const image = findImages()[0];
    expect(image.props.source).toEqual([{ uri: HOSTED }]);
    expect(image.props.cachePolicy).toBe("memory-disk");
  });

  it("web でブラウザのネイティブドラッグがジェスチャを奪わないよう draggable=false にする（issue #327）", async () => {
    await render(<WorkThumbnail uri={HOSTED} title={TITLE} />);
    expect(findImages()[0].props.draggable).toBe(false);
  });

  it("読み込み中は画像の下にプレースホルダーを敷く", async () => {
    const { getByText } = await render(
      <WorkThumbnail uri={HOSTED} title={TITLE} />,
    );
    expect(findImages()).toHaveLength(1);
    expect(getByText(TITLE)).toBeTruthy();
  });

  it("失敗後に URL が変わると読み込みをやり直す", async () => {
    const { rerender } = await render(
      <WorkThumbnail uri={HOSTED} title={TITLE} />,
    );
    await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
    await rerender(<WorkThumbnail uri={OTHER} title={TITLE} />);
    expect(findImages()[0].props.source).toEqual([{ uri: OTHER }]);
  });

  it("失敗した URL から別の URL を経て戻ったときも読み込み直す", async () => {
    const { rerender } = await render(
      <WorkThumbnail uri={HOSTED} title={TITLE} />,
    );
    await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
    await rerender(<WorkThumbnail uri={OTHER} title={TITLE} />);
    await rerender(<WorkThumbnail uri={HOSTED} title={TITLE} />);
    expect(findImages()[0].props.source).toEqual([{ uri: HOSTED }]);
  });

  it("画像 URL が無ければ最初からプレースホルダー", async () => {
    const { getByText, queryByText } = await render(
      <WorkThumbnail uri={null} title={TITLE} />,
    );
    expect(findImages()).toHaveLength(0);
    expect(getByText(TITLE)).toBeTruthy();
    expect(queryByText("No img")).toBeNull();
  });

  describe("読み込み失敗時の再試行（issue #522）", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("失敗したらプレースホルダーだけにし、間を置いてキャッシュ迂回の URL で読み込み直す", async () => {
      const { getByText } = await render(
        <WorkThumbnail uri={HOSTED} title={TITLE} />,
      );
      await fireEvent(findImages()[0], "onError", { nativeEvent: {} });

      // 再試行を待つ間はプレースホルダーだけにする
      expect(findImages()).toHaveLength(0);
      expect(getByText(TITLE)).toBeTruthy();

      // 再試行は同じパスのままだと失敗レスポンスが HTTP キャッシュから
      // 返って即座にまた失敗するので、クエリでキーを変える
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      expect(findImages()[0].props.source).toEqual([{ uri: `${HOSTED}?r=1` }]);
    });

    it("再試行を尽くしたら外部 URL を試さずプレースホルダーだけにする", async () => {
      const { getByText } = await render(
        <WorkThumbnail uri={HOSTED} title={TITLE} />,
      );
      await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(findImages()[0].props.source).toEqual([{ uri: `${HOSTED}?r=2` }]);

      await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
      expect(findImages()).toHaveLength(0);
      expect(getByText(TITLE)).toBeTruthy();
    });

    it("再試行待ちの間に URL が変わったら古い URL の再試行は捨てる", async () => {
      const { rerender } = await render(
        <WorkThumbnail uri={HOSTED} title={TITLE} />,
      );
      await fireEvent(findImages()[0], "onError", { nativeEvent: {} });
      await rerender(<WorkThumbnail uri={OTHER} title={TITLE} />);
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      // 古い HOSTED への再試行は発火せず、新しい URL の初回表示のまま
      expect(findImages()[0].props.source).toEqual([{ uri: OTHER }]);
    });
  });
});
