import React from "react";
import { render, screen } from "@testing-library/react-native";
import { PropertyPanel } from "@/components/meishi/PropertyPanel";
import type { MeishiRenderContext, TextElement } from "@/lib/meishi/types";

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

describe("PropertyPanel", () => {
  it("既存データ連携のテキスト要素でも文字列欄に要素の文字列を表示する", () => {
    render(
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

  it("名前連携のテキスト要素は文字列欄にプロフィールの名前を表示する", () => {
    render(
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

  it("好きなセリフ連携のテキスト要素は文字列欄にプロフィールの好きなセリフを表示する", () => {
    render(
      <PropertyPanel
        element={{ ...baseTextElement, source: "favoriteQuote", text: "好きなセリフ" }}
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
