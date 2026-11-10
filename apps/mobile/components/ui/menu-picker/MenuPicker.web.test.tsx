/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */

// jsdom + react-dom + react-native-web で実際の DOM を作って検証する。
// RNTL（react-test-renderer）では <button> の入れ子のような HTML 構造の
// 違反を検出できないため（issue #504）。
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
    border: "#ccc",
    scrim: "rgba(0, 0, 0, 0.5)",
    surface: "#fff",
    surfaceMuted: "#eee",
    text: "#000",
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

const renderPicker = async (onValueChange = jest.fn()) => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- import() は変換されず vm-modules 前提になるため require を使う
  ({ act } = require("react") as typeof import("react"));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRoot } = require("react-dom/client") as {
    createRoot: (el: Element | DocumentFragment) => ReactRoot;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { MenuPicker } =
    require("./MenuPicker.web") as typeof import("./MenuPicker.web");

  container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MenuPicker
        testID="test-menu"
        accessibilityLabel="年を選択"
        title="年を選択"
        closeAccessibilityLabel="年の選択を閉じる"
        selectedValue={2026}
        options={[
          { label: "2025年", value: 2025 },
          { label: "2026年", value: 2026 },
          { label: "2027年", value: 2027 },
        ]}
        onValueChange={onValueChange}
      />,
    );
  });
  return onValueChange;
};

const click = (element: Element) => {
  act(() => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
};

const openPicker = () => {
  const button = document.querySelector('[data-testid="test-menu-button"]');
  expect(button).not.toBeNull();
  click(button!);
};

// RNW の Modal（animationType="fade"）は animationend を待ってから
// DOM を取り外す。jsdom は CSS アニメーションを実行しないため、
// 実ブラウザで起きる終了イベントをこちらから発火させる。
const fireModalAnimationEnd = () => {
  for (const el of document.querySelectorAll("body > div")) {
    if (el !== container) {
      act(() => {
        el.firstElementChild?.dispatchEvent(
          new window.Event("animationend", { bubbles: true }),
        );
      });
    }
  }
};

const optionElement = () =>
  document.querySelector('[data-testid="test-menu-option-2025"]');

afterEach(() => {
  document.body.replaceChildren();
});

describe("MenuPicker (web DOM)", () => {
  it("モーダルを開いても操作可能な要素の入れ子が発生しない", async () => {
    await renderPicker();
    openPicker();
    // jest の transform 配下の RNW は <button> ではなく role="button" の
    // <div> を出力するため、タグ名と role 属性の両方を操作可能な要素として
    // 入れ子を検査する。実ブラウザではこれらが <button> として出るため
    // HTML の <button> 入れ子違反（issue #504）と同じ構造を検出できる。
    const interactive = "button, [role='button']";
    const nested = [...document.querySelectorAll(interactive)].filter((el) =>
      el.querySelector(interactive),
    );
    expect(nested).toHaveLength(0);
    expect(optionElement()).not.toBeNull();
  });

  it("選択肢をクリックすると onValueChange が呼ばれて閉じる", async () => {
    const onValueChange = await renderPicker();
    openPicker();

    const option = document.querySelector(
      '[data-testid="test-menu-option-2025"]',
    );
    expect(option).not.toBeNull();
    click(option!);

    expect(onValueChange).toHaveBeenCalledWith(2025);
    fireModalAnimationEnd();
    expect(optionElement()).toBeNull();
  });

  it("背景をクリックすると選択せずに閉じる", async () => {
    const onValueChange = await renderPicker();
    openPicker();

    const backdrop = document.querySelector('[aria-label="年の選択を閉じる"]');
    expect(backdrop).not.toBeNull();
    click(backdrop!);

    expect(onValueChange).not.toHaveBeenCalled();
    fireModalAnimationEnd();
    expect(optionElement()).toBeNull();
  });
});
