/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */

// jsdom + react-dom + react-native-web で実際の DOM を作って検証する
// （BottomSheet.web.test.tsx と同じ仕組み）。React Native Web は
// accessibilityState を DOM に出さないため、選択状態は aria-pressed で
// 出している（issue #809）。RNTL のレンダーでは DOM 属性まで確認できない。
jest.doMock("react-native", () => jest.requireActual("react-native-web"));
jest.doMock("@/lib/theme", () => ({
  useThemeColors: () => ({
    primaryBorder: "#00f",
    border: "#ccc",
  }),
}));
jest.doMock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
// jest の resolver は iOS 固定で .native 実装を選ぶため、Web DOM のテストでは
// ブラウザのバンドルで選ばれる .web 実装を明示的に使う。
jest.doMock("@/lib/accessibility", () =>
  jest.requireActual("@/lib/accessibility/selection.web"),
);

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let act: (typeof import("react"))["act"];

// @types/react-dom は devDependency に無いため必要な分だけ自前で定義する
type ReactRoot = {
  render: (node: import("react").ReactNode) => void;
  unmount: () => void;
};

const renderGrid = async (value: string) => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- import() は変換されず vm-modules 前提になるため require を使う
  ({ act } = require("react") as typeof import("react"));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createRoot } = require("react-dom/client") as {
    createRoot: (el: Element | DocumentFragment) => ReactRoot;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ColorGrid } = require("./ColorGrid") as typeof import("./ColorGrid");

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const rerender = async (v: string) => {
    await act(async () => {
      root.render(<ColorGrid value={v} onChange={jest.fn()} />);
    });
  };
  await rerender(value);
  return rerender;
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("ColorGrid (web DOM)", () => {
  it("見本が色名の aria-label を持つ", async () => {
    await renderGrid("#111827");
    expect(document.querySelector('[aria-label="黒"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="白"]')).not.toBeNull();
  });

  it("選択中の見本だけ aria-pressed が true になる", async () => {
    const rerender = await renderGrid("#111827");
    expect(
      document.querySelector('[aria-label="黒"][aria-pressed="true"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[aria-label="白"][aria-pressed="true"]'),
    ).toBeNull();

    // 別の色を選ぶと aria-pressed の位置も移る
    await rerender("#ffffff");
    expect(
      document.querySelector('[aria-label="黒"][aria-pressed="true"]'),
    ).toBeNull();
    expect(
      document.querySelector('[aria-label="白"][aria-pressed="true"]'),
    ).not.toBeNull();
  });
});
