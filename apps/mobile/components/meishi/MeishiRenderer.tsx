import { useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { BackgroundLayer } from "./BackgroundLayer";
import { ElementRenderer } from "./elements/ElementRenderer";
import { MEISHI_DESIGN_WIDTH } from "@/lib/meishi/defaults";
import type { MeishiDocument, MeishiRenderContext } from "@/lib/meishi/types";

export type MeishiRendererProps = {
  document: MeishiDocument;
  context: MeishiRenderContext;
  borderRadius?: number;
};

/**
 * MeishiDocument を受け取ってレンダリングするだけの純関数コンポーネント。
 * 編集機能は含まない（エディタ側の EditorCanvas を使う）。
 */
export function MeishiRenderer({
  document,
  context,
  borderRadius = 16,
}: MeishiRendererProps) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    const height = width / document.canvas.aspectRatio;
    setSize({ width, height });
  };

  return (
    <View
      onLayout={onLayout}
      style={{
        width: "100%",
        aspectRatio: document.canvas.aspectRatio,
        borderRadius,
        overflow: "hidden",
      }}
    >
      <BackgroundLayer style={document.canvas.background} borderRadius={borderRadius} />
      {size
        ? document.elements.map((el) => {
            const w = el.transform.width * size.width;
            const h = el.transform.height * size.height;
            const x = el.transform.x * size.width;
            const y = el.transform.y * size.height;
            const renderScale = size.width / MEISHI_DESIGN_WIDTH;
            return (
              <View
                key={el.id}
                pointerEvents="none"
                style={{
                  position: "absolute",
                  left: x,
                  top: y,
                  width: w,
                  height: h,
                  transform: [{ rotate: `${el.transform.rotation}deg` }],
                }}
              >
                <ElementRenderer
                  element={el}
                  ctx={context}
                  boxWidth={w}
                  boxHeight={h}
                  renderScale={renderScale}
                />
              </View>
            );
          })
        : null}
    </View>
  );
}
