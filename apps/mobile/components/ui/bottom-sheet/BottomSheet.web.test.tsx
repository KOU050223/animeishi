/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */

// jsdom + react-dom + react-native-web で実際の DOM を作って検証する。
// RNTL（react-test-renderer）では <button> の入れ子のような HTML 構造の
// 違反を検出できないため（issue #504、#529）。
//
// この環境ではファイル先頭の jest.mock("react-native") が後続の require に
// 効かない（セットアップファイルが先に react-native を解決するため、
// 登録時と参照時でモジュール ID が食い違う）。jest.resetModules() してから
// require した場合だけ差し替わるので、コンポーネントは resetModules のあと
// require で読み込む。reset すると react / react-dom も別コピーになる
// ため、renderer と act はコンポーネントと同じコピーを同じく require する。
// （JSX の要素はプレーンなオブジェクトなので React コピー間で共有できる）
jest.doMock("react-native", () => jest.requireActual("react-native-web"));
jest.doMock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.doMock("@/lib/theme", () => ({
  useThemeColors: () => ({
    scrim: "rgba(0, 0, 0, 0.5)",
    surface: "#fff",
    textMuted: "#666",
  }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let act: (typeof import("react"))["act"];

// @types/react-dom は devDependency に無いため必要な分だけ自前で定義する
type ReactRoot = {
  render: (node: import("react").ReactNode) => void;
  unmount: () => void;
};

const renderSheet = async (
  onClose = jest.fn(),
  props: { closeButtonAccessibilityLabel?: string } = {},
) => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- import() は変換されず vm-modules 前提になるため require を使う
  ({ act } = require("react") as typeof import("react"));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRoot } = require("react-dom/client") as {
    createRoot: (el: Element | DocumentFragment) => ReactRoot;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { BottomSheet } =
    require("./BottomSheet.web") as typeof import("./BottomSheet.web");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pressable, Text } =
    require("react-native") as typeof import("react-native");

  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <BottomSheet
        visible
        onClose={onClose}
        scrimAccessibilityLabel="背景で閉じる"
        testID="test-sheet"
        {...props}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="シート内のボタン"
          testID="sheet-inner-button"
        >
          <Text>シート内</Text>
        </Pressable>
      </BottomSheet>,
    );
  });
  return onClose;
};

const click = (element: Element) => {
  act(() => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
};

const scrimElement = () =>
  document.querySelector('[aria-label="背景で閉じる"]');
const closeButtonElement = () =>
  document.querySelector('[data-testid="test-sheet-close"]');
const innerButtonElement = () =>
  document.querySelector('[aria-label="シート内のボタン"]');

afterEach(() => {
  document.body.replaceChildren();
});

describe("BottomSheet (web DOM)", () => {
  it("開いても操作可能な要素の入れ子が発生しない", async () => {
    await renderSheet(jest.fn(), {
      closeButtonAccessibilityLabel: "ボタンで閉じる",
    });
    // jest の transform 配下の RNW は <button> ではなく role="button" の
    // <div> を出力するため、タグ名と role 属性の両方を操作可能な要素として
    // 入れ子を検査する。実ブラウザではこれらが <button> として出るため
    // HTML の <button> 入れ子違反（issue #504）と同じ構造を検出できる。
    const interactive = "button, [role='button']";
    const nested = [...document.querySelectorAll(interactive)].filter((el) =>
      el.querySelector(interactive),
    );
    expect(nested).toHaveLength(0);
    expect(scrimElement()).not.toBeNull();
    expect(innerButtonElement()).not.toBeNull();
  });

  it("背景をクリックすると onClose が呼ばれる", async () => {
    const onClose = await renderSheet();
    expect(scrimElement()).not.toBeNull();
    click(scrimElement()!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("閉じるボタンをクリックすると onClose が呼ばれる", async () => {
    const onClose = await renderSheet(jest.fn(), {
      closeButtonAccessibilityLabel: "ボタンで閉じる",
    });
    const button = closeButtonElement();
    expect(button).not.toBeNull();
    click(button!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("シート内をクリックしても onClose は呼ばれない", async () => {
    const onClose = await renderSheet();
    const card = document.querySelector('[data-testid="test-sheet"]');
    expect(card).not.toBeNull();
    click(card!);
    click(innerButtonElement()!);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closeButtonAccessibilityLabel が無ければ閉じるボタンを出さない", async () => {
    await renderSheet();
    expect(closeButtonElement()).toBeNull();
    expect(scrimElement()).not.toBeNull();
  });
});
