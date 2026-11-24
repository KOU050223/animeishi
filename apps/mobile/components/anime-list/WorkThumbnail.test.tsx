import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { WorkThumbnail } from "./WorkThumbnail";
import { WorkImage } from "./WorkImage";

// リトライのキャッシュバスターは自前の画像プロキシ（apiUrl 起点 /images/）
// にだけ付く。jest では EXPO_PUBLIC_API_URL 未設定なので既定の
// http://localhost:8787 を使う。
const HOSTED = "http://localhost:8787/images/works/1";
const OTHER = "http://localhost:8787/images/works/2";
const EXTERNAL = "https://cdn.example.com/poster.jpg?sig=abc";
const TITLE = "銀河鉄道の夜";

// expo-image は requireNativeView("ExpoImage") のネイティブビュー。
// RN 0.88 ではレガシー ViewManager が ViewManagerAdapter_ 接頭辞付きの
// ホスト名でマウントされるため、ExpoImage で終わる型名で絞る。
// RNTL 14 では UNSAFE_getByType が無いため queryAll でホスト要素を探す。
const findImages = () =>
  screen.container.queryAll(
    (node) => typeof node.type === "string" && node.type.endsWith("ExpoImage"),
  );

// 画像が描画されていることを前提にする箇所用。無ければテストを失敗させる。
const firstImage = () => {
  const image = findImages()[0];
  if (!image) throw new Error("ExpoImage が見つかりません");
  return image;
};

describe("WorkThumbnail", () => {
  it("作品画像プロキシの URL を expo-image でディスクキャッシュ付きで表示する", async () => {
    await render(<WorkThumbnail uri={HOSTED} title={TITLE} />);
    const image = firstImage();
    expect(image.props.source).toEqual([{ uri: HOSTED }]);
    expect(image.props.cachePolicy).toBe("memory-disk");
  });

  it("web でブラウザのネイティブドラッグがジェスチャを奪わないよう draggable=false にする（issue #327）", async () => {
    await render(<WorkThumbnail uri={HOSTED} title={TITLE} />);
    expect(firstImage().props.draggable).toBe(false);
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
    await fireEvent(firstImage(), "onError", { nativeEvent: {} });
    await rerender(<WorkThumbnail uri={OTHER} title={TITLE} />);
    expect(firstImage().props.source).toEqual([{ uri: OTHER }]);
  });

  it("失敗した URL から別の URL を経て戻ったときも読み込み直す", async () => {
    const { rerender } = await render(
      <WorkThumbnail uri={HOSTED} title={TITLE} />,
    );
    await fireEvent(firstImage(), "onError", { nativeEvent: {} });
    await rerender(<WorkThumbnail uri={OTHER} title={TITLE} />);
    await rerender(<WorkThumbnail uri={HOSTED} title={TITLE} />);
    expect(firstImage().props.source).toEqual([{ uri: HOSTED }]);
  });

  it("onLoad は expo-image の onLoad にそのまま渡る", async () => {
    const onLoad = jest.fn();
    await render(
      <WorkImage
        uri={HOSTED}
        style={{ width: 48, height: 64 }}
        placeholder={null}
        onLoad={onLoad}
      />,
    );
    const event = { nativeEvent: { source: { width: 960, height: 640 } } };
    await fireEvent(firstImage(), "onLoad", event);
    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({ source: { width: 960, height: 640 } }),
    );
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
      await fireEvent(firstImage(), "onError", { nativeEvent: {} });

      // 再試行を待つ間はプレースホルダーだけにする
      expect(findImages()).toHaveLength(0);
      expect(getByText(TITLE)).toBeTruthy();

      // 再試行は同じパスのままだと失敗レスポンスが HTTP キャッシュから
      // 返って即座にまた失敗するので、クエリでキーを変える
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      expect(firstImage().props.source).toEqual([{ uri: `${HOSTED}?r=1` }]);
    });

    it("再試行を尽くしたら外部 URL を試さずプレースホルダーだけにする", async () => {
      const { getByText } = await render(
        <WorkThumbnail uri={HOSTED} title={TITLE} />,
      );
      await fireEvent(firstImage(), "onError", { nativeEvent: {} });
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      await fireEvent(firstImage(), "onError", { nativeEvent: {} });
      await act(async () => {
        jest.advanceTimersByTime(4000);
      });
      expect(firstImage().props.source).toEqual([{ uri: `${HOSTED}?r=2` }]);

      await fireEvent(firstImage(), "onError", { nativeEvent: {} });
      expect(findImages()).toHaveLength(0);
      expect(getByText(TITLE)).toBeTruthy();
    });

    it("再試行待ちの間に URL が変わったら古い URL の再試行は捨てる", async () => {
      const { rerender } = await render(
        <WorkThumbnail uri={HOSTED} title={TITLE} />,
      );
      await fireEvent(firstImage(), "onError", { nativeEvent: {} });
      await rerender(<WorkThumbnail uri={OTHER} title={TITLE} />);
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      // 古い HOSTED への再試行は発火せず、新しい URL の初回表示のまま
      expect(firstImage().props.source).toEqual([{ uri: OTHER }]);
    });

    it("外部 URL の再試行はクエリを足さず同じ URL でやり直す", async () => {
      await render(<WorkThumbnail uri={EXTERNAL} title={TITLE} />);
      await fireEvent(firstImage(), "onError", { nativeEvent: {} });
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      // 署名付きクエリを持つ外部 URL に r= を足すと署名が壊れるため
      expect(firstImage().props.source).toEqual([{ uri: EXTERNAL }]);
    });

    // TierBoardSnapshot / MeishiShareSnapshot は onLoadEnd の到達回数を
    // 確定した画像の枚数として数えるので、リトライの発火で重複計上させない。
    it("onLoadEnd はリトライをまたいでも 1 URI につき 1 回だけ呼ばれる", async () => {
      const onLoadEnd = jest.fn();
      const { rerender } = await render(
        <WorkImage
          uri={HOSTED}
          style={{ width: 48, height: 64 }}
          placeholder={null}
          onLoadEnd={onLoadEnd}
        />,
      );
      // onError で画像要素は退くため、切り離される前に確定イベントを済ませる
      const first = firstImage();
      await fireEvent(first, "onLoadEnd", { nativeEvent: {} });
      await fireEvent(first, "onError", { nativeEvent: {} });
      expect(onLoadEnd).toHaveBeenCalledTimes(1);

      // 再試行が終わっても（成功・失敗どちらでも）再通知しない
      await act(async () => {
        jest.advanceTimersByTime(1500);
      });
      await fireEvent(firstImage(), "onLoadEnd", { nativeEvent: {} });
      expect(onLoadEnd).toHaveBeenCalledTimes(1);

      // URI が変われば新しい読み込みとして 1 回通知する
      await rerender(
        <WorkImage
          uri={OTHER}
          style={{ width: 48, height: 64 }}
          placeholder={null}
          onLoadEnd={onLoadEnd}
        />,
      );
      await fireEvent(firstImage(), "onLoadEnd", { nativeEvent: {} });
      expect(onLoadEnd).toHaveBeenCalledTimes(2);
    });
  });
});
