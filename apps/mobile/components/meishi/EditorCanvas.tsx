import { useMemo, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { BackgroundLayer } from "./BackgroundLayer";
import { ElementRenderer } from "./elements/ElementRenderer";
import { SelectionOverlay } from "./SelectionOverlay";
import { MEISHI_DESIGN_WIDTH } from "@/lib/meishi/defaults";
import type {
  MeishiDocument,
  MeishiElement,
  MeishiRenderContext,
  Transform,
} from "@/lib/meishi/types";

type Size = { width: number; height: number };

export type EditorCanvasProps = {
  document: MeishiDocument;
  context: MeishiRenderContext;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onTransform: (id: string, transform: Transform) => void;
  onCommit?: () => void;
};

/**
 * 編集用キャンバス。要素タップで選択、選択枠の操作で移動/リサイズ/回転を行う。
 * onTransform は連続的に呼ばれる（ジェスチャ中）。onCommit は onEnd で1回だけ呼ばれる。
 */
export function EditorCanvas({
  document,
  context,
  selectedId,
  onSelect,
  onTransform,
  onCommit,
}: EditorCanvasProps) {
  const [size, setSize] = useState<Size | null>(null);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    const height = width / document.canvas.aspectRatio;
    setSize({ width, height });
  };

  const tapBackground = useMemo(
    () => Gesture.Tap().onEnd(() => onSelect(null)),
    [onSelect],
  );

  return (
    <GestureDetector gesture={tapBackground}>
      <View
        onLayout={onLayout}
        style={{
          width: "100%",
          aspectRatio: document.canvas.aspectRatio,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: "#f3f4f6",
        }}
      >
        <BackgroundLayer style={document.canvas.background} borderRadius={12} />
        {size ? (
          <>
            {document.elements.map((el) => (
              <ElementBox
                key={el.id}
                el={el}
                canvasSize={size}
                context={context}
                isSelected={el.id === selectedId}
                onSelect={() => onSelect(el.id)}
                onTransform={(t) => onTransform(el.id, t)}
                onCommit={onCommit}
              />
            ))}
            {selectedId
              ? (() => {
                  const el = document.elements.find((e) => e.id === selectedId);
                  if (!el) return null;
                  return (
                    <SelectionOverlay
                      element={el}
                      canvasSize={size}
                      onTransform={(t) => onTransform(el.id, t)}
                      onCommit={onCommit}
                    />
                  );
                })()
              : null}
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
}

function ElementBox({
  el,
  canvasSize,
  context,
  isSelected,
  onSelect,
  onTransform,
  onCommit,
}: {
  el: MeishiElement;
  canvasSize: Size;
  context: MeishiRenderContext;
  isSelected: boolean;
  onSelect: () => void;
  onTransform: (t: Transform) => void;
  onCommit?: () => void;
}) {
  const boxW = el.transform.width * canvasSize.width;
  const boxH = el.transform.height * canvasSize.height;
  const x = el.transform.x * canvasSize.width;
  const y = el.transform.y * canvasSize.height;
  const renderScale = canvasSize.width / MEISHI_DESIGN_WIDTH;

  const start = useRef<Transform>(el.transform);
  // 最新の transform を ref 経由で参照することで、pan の useMemo 依存から外す。
  // これにより setElementTransformLive でドラッグ中に el.transform が変わっても、
  // Gesture.Pan インスタンスが再生成されず、ジェスチャが中断されない。
  const latestTransformRef = useRef<Transform>(el.transform);
  latestTransformRef.current = el.transform;

  const tap = useMemo(
    () => Gesture.Tap().onEnd(() => onSelect()),
    [onSelect],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isSelected)
        .onStart(() => {
          start.current = latestTransformRef.current;
        })
        .onUpdate((e) => {
          const nx = clamp01(start.current.x + e.translationX / canvasSize.width);
          const ny = clamp01(start.current.y + e.translationY / canvasSize.height);
          onTransform({ ...start.current, x: nx, y: ny });
        })
        .onEnd(() => {
          onCommit?.();
        }),
    [isSelected, canvasSize.width, canvasSize.height, onTransform, onCommit],
  );

  const composed = useMemo(() => Gesture.Race(pan, tap), [pan, tap]);

  return (
    <GestureDetector gesture={composed}>
      <View
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: boxW,
          height: boxH,
          transform: [{ rotate: `${el.transform.rotation}deg` }],
        }}
      >
        <ElementRenderer
          element={el}
          ctx={context}
          boxWidth={boxW}
          boxHeight={boxH}
          renderScale={renderScale}
        />
      </View>
    </GestureDetector>
  );
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
