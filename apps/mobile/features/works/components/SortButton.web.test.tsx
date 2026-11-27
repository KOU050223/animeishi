/**
 * @jest-environment <rootDir>/jest.jsdom-env.cjs
 */

// jsdom + react-dom + react-native-web で実際の DOM を作って検証する。
// jest の resolver は iOS 固定で .native 実装を選ぶため、Web DOM のテストでは
// ブラウザのバンドルで選ばれる .web 実装を明示的に使う。
jest.doMock("react-native", () => jest.requireActual("react-native-web"));
jest.doMock("@/lib/accessibility", () =>
  jest.requireActual("@/lib/accessibility/selection.web"),
);
jest.doMock("@expo/vector-icons/Ionicons", () => ({
  __esModule: true,
  default: () => null,
}));
jest.doMock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { label?: string }) =>
      key.replace("{{label}}", options?.label ?? ""),
  }),
}));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

type ReactRoot = {
  render: (node: import("react").ReactNode) => void;
  unmount: () => void;
};

let act: (typeof import("react"))["act"];
let createRoot: (el: Element | DocumentFragment) => ReactRoot;
let SortButton: typeof import("./SortButton").SortButton;
const roots: ReactRoot[] = [];

beforeAll(() => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- import() は変換されず vm-modules 前提になるため require を使う
  ({ act } = require("react") as typeof import("react"));
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ createRoot } = require("react-dom/client") as {
    createRoot: typeof createRoot;
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  ({ SortButton } = require("./SortButton") as typeof import("./SortButton"));
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  document.body.replaceChildren();
});

describe("SortButton (web DOM)", () => {
  it("現在のソートキーを aria-pressed ではなく aria-current で示す", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const { createElement, Fragment } = jest.requireActual(
      "react",
    ) as typeof import("react");

    await act(async () => {
      root.render(
        createElement(
          Fragment,
          null,
          createElement(SortButton, {
            label: "人気",
            icon: "flame-outline",
            active: true,
            order: "desc",
            onPress: () => {},
          }),
          createElement(SortButton, {
            label: "タイトル",
            icon: "text-outline",
            active: false,
            order: null,
            onPress: () => {},
          }),
        ),
      );
    });

    const active = document.querySelector('[aria-label="人気 降順"]');
    expect(active).not.toBeNull();
    expect(active!.getAttribute("aria-pressed")).toBeNull();
    expect(active!.getAttribute("aria-current")).toBe("true");

    const inactive = document.querySelector('[aria-label="タイトル"]');
    expect(inactive).not.toBeNull();
    expect(inactive!.getAttribute("aria-pressed")).toBeNull();
    expect(inactive!.getAttribute("aria-current")).toBe("false");
  });
});
