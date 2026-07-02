import React from "react";
import { Text, StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";
import { ElementRenderer } from "@/components/meishi/elements/ElementRenderer";
import type { MeishiRenderContext, TextElement } from "@/lib/meishi/types";

const ctx: MeishiRenderContext = {
  profile: {
    username: "長いユーザー名である寿限無寿限無、五劫のすり切れ、海砂利水魚の水行末 雲来末 風来末、食う寝るところに住むところ、やぶらこうじのぶらこうじ、パイポパイポ パイポのシューリンガン、シューリンガンのグーリンダイ、グーリンダイのポンポコピーのポンポコナーの、長久命の長助",
  },
};

const textElement: TextElement = {
  id: "text-1",
  type: "text",
  transform: { x: 0, y: 0, width: 0.5, height: 0.1, rotation: 0 },
  text: "テキスト",
  source: "username",
  fontSize: 24,
  fontFamily: "system",
  fontWeight: "bold",
  fontStyle: "normal",
  color: "#111827",
  align: "left",
};

describe("ElementRenderer", () => {
  it("テキストの fontSize を renderScale に合わせて縮小する", () => {
    const { UNSAFE_getByType } = render(
      <ElementRenderer
        element={textElement}
        ctx={ctx}
        boxWidth={200}
        boxHeight={80}
        renderScale={0.5}
      />,
    );

    const text = UNSAFE_getByType(Text);
    const style = StyleSheet.flatten(text.props.style);

    expect(style.fontSize).toBe(12);
  });
});
