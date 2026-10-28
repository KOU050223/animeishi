import { render, screen } from "@testing-library/react-native";
import { useColorScheme } from "nativewind";
import {
  StyleSheet,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { TierBoardSnapshot } from "./TierBoardSnapshot";
import { colors } from "@/lib/theme";

// jest.setup.js のグローバルモックと同じ形で、スキームを個別に切り替えられるよう
// このファイル内では再モックする。
jest.mock("nativewind", () => ({
  useColorScheme: jest.fn(() => ({
    colorScheme: "light",
    setColorScheme: jest.fn(),
    toggleColorScheme: jest.fn(),
  })),
}));

const mockUseColorScheme = jest.mocked(useColorScheme);

const setScheme = (colorScheme: "light" | "dark") =>
  mockUseColorScheme.mockReturnValue({
    colorScheme,
    setColorScheme: jest.fn(),
    toggleColorScheme: jest.fn(),
  });

// スキームを切り替えたテストが後続へ漏れないよう、各テストの前に light へ戻す。
beforeEach(async () => {
  setScheme("light");
});

const TIERS = [
  { key: "s", label: "S", color: "#ff7f7f" },
  { key: "a", label: "A", color: "#ffbf7f" },
];

const ITEMS = [
  { id: 1, tierKey: "s", title: "作品A" },
  { id: 2, tierKey: "a", title: "作品B" },
  { id: 3, tierKey: "s", title: "作品C" },
];

const ITEMS_WITH_IMAGES = [
  {
    id: 1,
    tierKey: "s",
    title: "作品A",
    imageUrl: "https://example.com/a.png",
  },
  {
    id: 2,
    tierKey: "a",
    title: "作品B",
    imageUrl: "https://example.com/b.png",
  },
];

describe("TierBoardSnapshot", () => {
  it("タイトルと各 tier のラベル・作品を表示する", async () => {
    const { getByText } = await render(
      <TierBoardSnapshot title="2026春のTier表" tiers={TIERS} items={ITEMS} />,
    );

    expect(getByText("2026春のTier表")).toBeTruthy();
    expect(getByText("S")).toBeTruthy();
    expect(getByText("A")).toBeTruthy();
    expect(getByText("作品A")).toBeTruthy();
    expect(getByText("作品B")).toBeTruthy();
    expect(getByText("作品C")).toBeTruthy();
  });

  it("未分類の作品は描画しない", async () => {
    const { queryByText } = await render(
      <TierBoardSnapshot
        title="t"
        tiers={TIERS}
        items={[{ id: 9, tierKey: "zzz", title: "幽霊作品" }]}
      />,
    );

    expect(queryByText("幽霊作品")).toBeNull();
  });

  describe("配色", () => {
    // 共有画像は撮影時点のスキームに追従する（盤面と同じ見た目になる）。
    const rootBackgroundOf = (root: { props: { style?: unknown } }) =>
      StyleSheet.flatten(root.props.style as StyleProp<ViewStyle>)
        ?.backgroundColor;

    // ルート View だけが collapsable={false} を持つ（view-shot 用）。
    // RNTL 14 では UNSAFE_root/findByProps が無いため queryAll で絞る。
    const boardView = () =>
      screen.container.queryAll((node) => node.props.collapsable === false)[0];

    it("light スキームでは白系の背景で描く", async () => {
      await render(<TierBoardSnapshot title="t" tiers={TIERS} items={ITEMS} />);
      expect(rootBackgroundOf(boardView())).toBe(colors.light.background);
    });

    it("dark スキームでは暗色の背景で描く", async () => {
      setScheme("dark");
      await render(<TierBoardSnapshot title="t" tiers={TIERS} items={ITEMS} />);
      expect(rootBackgroundOf(boardView())).toBe(colors.dark.background);
    });

    it("tier ラベルの文字色は行の背景色とのコントラストで決まる", async () => {
      // TIERS の s は #ff7f7f。明るい側なので濃色文字が返る。
      const { getByText } = await render(
        <TierBoardSnapshot title="t" tiers={TIERS} items={ITEMS} />,
      );
      const style = StyleSheet.flatten(
        getByText("S").props.style as StyleProp<TextStyle>,
      );
      expect(style?.color).toBe("#1f2937");
    });
  });

  describe("onReady", () => {
    it("画像が無い表はマウント直後に onReady を呼ぶ", async () => {
      const onReady = jest.fn();
      await render(
        <TierBoardSnapshot
          title="t"
          tiers={TIERS}
          items={ITEMS}
          onReady={onReady}
        />,
      );
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it("全画像の読み込み（onLoadEnd）が終わるまで onReady を呼ばない", async () => {
      const onReady = jest.fn();
      await render(
        <TierBoardSnapshot
          title="t"
          tiers={TIERS}
          items={ITEMS_WITH_IMAGES}
          onReady={onReady}
        />,
      );

      expect(onReady).not.toHaveBeenCalled();

      // RN 0.88 ではレガシー ViewManager が ViewManagerAdapter_ 接頭辞付きの
      // ホスト名でマウントされるため、ExpoImage で終わる型名で絞る。
      const images = screen.container.queryAll(
        (node) =>
          typeof node.type === "string" && node.type.endsWith("ExpoImage"),
      );
      expect(images).toHaveLength(2);

      // 1 枚目の完了ではまだ呼ばれない
      images[0].props.onLoadEnd();
      expect(onReady).not.toHaveBeenCalled();

      // 全件完了で一度だけ呼ばれる（読み込み失敗でも onLoadEnd は来る）
      images[1].props.onLoadEnd();
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    it("撮影時にフェードイン途中の画像が写らないよう transition を付けない", async () => {
      await render(
        <TierBoardSnapshot title="t" tiers={TIERS} items={ITEMS_WITH_IMAGES} />,
      );
      for (const image of screen.container.queryAll(
        (node) =>
          typeof node.type === "string" && node.type.endsWith("ExpoImage"),
      )) {
        // expo-image 3.x は transition={0} を { duration: 0 } に正規化して
        // ネイティブビューへ渡す。
        expect(image.props.transition).toEqual({ duration: 0 });
      }
    });

    it("tiers に無い tierKey の画像付き作品は読み込み待ちに含めない", async () => {
      // 描画されない画像は onLoadEnd が来ない。読み込み待ち対象に数えると
      // onReady が永久に発火せずキャプチャがタイムアウト待ちになる。
      const onReady = jest.fn();
      await render(
        <TierBoardSnapshot
          title="t"
          tiers={TIERS}
          items={[
            {
              id: 9,
              tierKey: "zzz",
              title: "幽霊作品",
              imageUrl: "https://example.com/ghost.png",
            },
          ]}
          onReady={onReady}
        />,
      );
      expect(onReady).toHaveBeenCalledTimes(1);
    });
  });
});
