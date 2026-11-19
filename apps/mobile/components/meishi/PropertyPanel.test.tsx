import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { PropertyPanel } from "@/components/meishi/PropertyPanel";
import i18n from "@/lib/i18n";
import type {
  ImageElement,
  MeishiRenderContext,
  TextElement,
} from "@/lib/meishi/types";

jest.mock("react-native-gesture-handler", () => {
  let end:
    | ((event: { translationX: number; translationY: number }) => void)
    | undefined;
  const pan = {
    runOnJS: () => pan,
    onUpdate: () => pan,
    onEnd: (handler: typeof end) => {
      end = handler;
      return pan;
    },
    onFinalize: () => pan,
  };
  return {
    Gesture: { Pan: () => pan },
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    getPanEnd: () => end,
  };
});

const baseTextElement: TextElement = {
  id: "text-1",
  type: "text",
  transform: { x: 0, y: 0, width: 0.5, height: 0.1, rotation: 0 },
  text: "It's My Go!!!!!",
  source: "favoriteQuote",
  fontSize: 24,
  fontFamily: "system",
  fontWeight: "bold",
  fontStyle: "italic",
  color: "#111827",
  align: "left",
};

const context: MeishiRenderContext = {
  profile: {
    username: "kou050223",
    favoriteQuote: "迷子でも進め",
  },
};

const imageElement: ImageElement = {
  id: "image-1",
  type: "image",
  transform: { x: 0, y: 0, width: 0.5, height: 0.5, rotation: 0 },
  uri: "https://img.example/photo.jpg",
  source: "upload",
  shape: "rect",
  objectFit: "cover",
};

describe("PropertyPanel", () => {
  it("cover 画像に切り抜き位置をドラッグ調整する枠を表示する", async () => {
    await render(
      <PropertyPanel
        element={imageElement}
        canvasAspectRatio={1.5}
        onChange={jest.fn()}
        onOpenTextEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onBringToFront={jest.fn()}
        onSendToBack={jest.fn()}
      />,
    );
    expect(screen.getByText("切り抜き位置")).toBeTruthy();
    expect(screen.getByTestId("meishi-image-focus-preview")).toBeTruthy();
  });

  it("プレビュー内のドラッグ終了時に正規化した焦点を保存する", async () => {
    const onChange = jest.fn();
    await render(
      <PropertyPanel
        element={imageElement}
        onChange={onChange}
        onOpenTextEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onBringToFront={jest.fn()}
        onSendToBack={jest.fn()}
      />,
    );
    const image = screen.container.queryAll(
      (node) => node.props.contentFit === "cover",
    )[0];
    await act(async () => {
      image.props.onLoad({
        nativeEvent: { source: { width: 240, height: 120 } },
      });
    });
    const { getPanEnd } = jest.requireMock("react-native-gesture-handler") as {
      getPanEnd: () => (event: {
        translationX: number;
        translationY: number;
      }) => void;
    };
    await act(async () => {
      getPanEnd()({ translationX: 30, translationY: 0 });
    });
    expect(onChange).toHaveBeenCalledWith({ focus: { x: 0.25, y: 0.5 } });
  });

  it("支援技術のカスタムアクションで切り抜き位置をずらせる", async () => {
    const onChange = jest.fn();
    await render(
      <PropertyPanel
        element={{ ...imageElement, focus: { x: 0.5, y: 0.5 } }}
        canvasAspectRatio={1.5}
        onChange={onChange}
        onOpenTextEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onBringToFront={jest.fn()}
        onSendToBack={jest.fn()}
      />,
    );
    const preview = screen.getByTestId("meishi-image-focus-preview");
    expect(preview.props.accessibilityValue).toEqual({
      text: "横 50%、縦 50%",
    });
    await act(async () => {
      preview.props.onAccessibilityAction({
        nativeEvent: { actionName: "left" },
      });
    });
    expect(onChange).toHaveBeenCalledWith({ focus: { x: 0.4, y: 0.5 } });
  });

  it("方向ボタンで切り抜き位置をずらせる", async () => {
    const onChange = jest.fn();
    await render(
      <PropertyPanel
        element={{ ...imageElement, focus: { x: 0.5, y: 0.5 } }}
        canvasAspectRatio={1.5}
        onChange={onChange}
        onOpenTextEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onBringToFront={jest.fn()}
        onSendToBack={jest.fn()}
      />,
    );
    await fireEvent.press(screen.getByLabelText("表示位置を下へ"));
    expect(onChange).toHaveBeenCalledWith({ focus: { x: 0.5, y: 0.6 } });
  });

  it("web のネイティブ画像ドラッグがプレビューの Pan を奪わない（issue #327）", async () => {
    await render(
      <PropertyPanel
        element={imageElement}
        canvasAspectRatio={1.5}
        onChange={jest.fn()}
        onOpenTextEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onBringToFront={jest.fn()}
        onSendToBack={jest.fn()}
      />,
    );
    const image = screen.container.queryAll(
      (node) => node.props.contentPosition,
    )[0];
    expect(image.props.draggable).toBe(false);
  });

  it("英語では切り抜き位置の案内を翻訳する", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    try {
      await render(
        <PropertyPanel
          element={imageElement}
          onChange={jest.fn()}
          onOpenTextEdit={jest.fn()}
          onDelete={jest.fn()}
          onDuplicate={jest.fn()}
          onBringToFront={jest.fn()}
          onSendToBack={jest.fn()}
        />,
      );
      expect(screen.getByText("Crop position")).toBeTruthy();
      expect(
        screen.getByText("Drag the image to adjust its position"),
      ).toBeTruthy();
      expect(screen.getByText("Reset to center")).toBeTruthy();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("ja");
      });
    }
  });

  it("英語では内容チップと説明を翻訳する", async () => {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    try {
      await render(
        <PropertyPanel
          element={baseTextElement}
          onChange={jest.fn()}
          onOpenTextEdit={jest.fn()}
          onDelete={jest.fn()}
          onDuplicate={jest.fn()}
          onBringToFront={jest.fn()}
          onSendToBack={jest.fn()}
        />,
      );
      expect(screen.getByText("Content source")).toBeTruthy();
      expect(screen.getByText("Quote")).toBeTruthy();
      expect(
        screen.getByText(
          "Custom shows typed text; Name, Bio, and Quote show your profile details.",
        ),
      ).toBeTruthy();
    } finally {
      await act(async () => {
        await i18n.changeLanguage("ja");
      });
    }
  });

  it("内容の各チップが差し替える値を説明する", async () => {
    await render(
      <PropertyPanel
        element={baseTextElement}
        onChange={jest.fn()}
        onOpenTextEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onBringToFront={jest.fn()}
        onSendToBack={jest.fn()}
      />,
    );

    expect(
      screen.getByText(
        "自由は入力した文字、名前・紹介・セリフはプロフィールの内容を表示します",
      ),
    ).toBeTruthy();
  });

  it("既存データ連携のテキスト要素でも文字列欄に要素の文字列を表示する", async () => {
    await render(
      <PropertyPanel
        element={baseTextElement}
        onChange={jest.fn()}
        onOpenTextEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onBringToFront={jest.fn()}
        onSendToBack={jest.fn()}
      />,
    );

    expect(screen.getByText("It's My Go!!!!!")).toBeTruthy();
  });

  it("名前連携のテキスト要素は文字列欄にプロフィールの名前を表示する", async () => {
    await render(
      <PropertyPanel
        element={{ ...baseTextElement, source: "username", text: "名前" }}
        context={context}
        onChange={jest.fn()}
        onOpenTextEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onBringToFront={jest.fn()}
        onSendToBack={jest.fn()}
      />,
    );

    expect(screen.getByText("kou050223")).toBeTruthy();
  });

  it("好きなセリフ連携のテキスト要素は文字列欄にプロフィールの好きなセリフを表示する", async () => {
    await render(
      <PropertyPanel
        element={{
          ...baseTextElement,
          source: "favoriteQuote",
          text: "好きなセリフ",
        }}
        context={context}
        onChange={jest.fn()}
        onOpenTextEdit={jest.fn()}
        onDelete={jest.fn()}
        onDuplicate={jest.fn()}
        onBringToFront={jest.fn()}
        onSendToBack={jest.fn()}
      />,
    );

    expect(screen.getByText("迷子でも進め")).toBeTruthy();
  });
});
