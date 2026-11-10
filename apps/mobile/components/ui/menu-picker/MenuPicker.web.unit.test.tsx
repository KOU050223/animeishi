// @vitest-environment jsdom

// jsdom + react-dom + react-native-web で実際の DOM を作って検証する。
// jest 側（RNTL）では <button> の入れ子のような HTML 構造の違反を
// 検出できないため（issue #504）。
import { act } from "react";
// @ts-expect-error -- @types/react-dom は devDependency に無い（DOM 検証はこのテストだけ）
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MenuPicker } from "./MenuPicker.web";

vi.mock(
  "react-native",
  // @ts-expect-error -- react-native-web は型定義を公開していない
  () => import("react-native-web"),
);
vi.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
vi.mock("@/lib/theme", () => ({
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
let root: ReturnType<typeof createRoot>;

const click = (element: Element) => {
  act(() => {
    element.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
};

const renderPicker = async (onValueChange = vi.fn()) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
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
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("MenuPicker (web DOM)", () => {
  it("モーダルを開いても button の入れ子が発生しない", async () => {
    await renderPicker();
    openPicker();
    expect(document.querySelectorAll("button button")).toHaveLength(0);
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
