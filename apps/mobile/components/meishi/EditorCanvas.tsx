import { useEffect, useMemo, useRef, useState } from "react";
import { View, type LayoutChangeEvent, type ViewInstance } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { useThemeColors } from "@/lib/theme";
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
  const colors = useThemeColors();
  const [size, setSize] = useState<Size | null>(null);
  const canvasRef = useRef<ViewInstance>(null);
  // キャンバスの画面上の絶対原点（px）。回転ジェスチャで absoluteX/Y をキャンバスローカルに変換するのに使う。
  // ジェスチャコールバックから参照するため ref ではなく SharedValue にする
  // （ref だと React Compiler 系 lint の react/refs に引っかかる）。
  const canvasOrigin = useSharedValue({ x: 0, y: 0 });

  const measureCanvas = () => {
    canvasRef.current?.measureInWindow((x, y) => {
      canvasOrigin.set({ x, y });
    });
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    const height = width / document.canvas.aspectRatio;
    setSize({ width, height });
    // レイアウト確定後にウィンドウ内絶対座標を測る（スクロールや親再配置に追随）。
    measureCanvas();
  };

  const tapBackground = useMemo(
    () => Gesture.Tap().onEnd(() => onSelect(null)),
    [onSelect],
  );

  return (
    <GestureDetector gesture={tapBackground}>
      <View
        ref={canvasRef}
        onLayout={onLayout}
        collapsable={false}
        style={{
          width: "100%",
          aspectRatio: document.canvas.aspectRatio,
          borderRadius: 12,
          overflow: "hidden",
          backgroundColor: colors.surfaceMuted,
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
                      // SharedValue を effect で同期しているため、選択切替時に
                      // 前要素の値が残る窓を key で閉じる（ElementBox と同じく
                      // 要素ごとに新しいインスタンスを作る）。
                      key={el.id}
                      element={el}
                      canvasSize={size}
                      canvasOrigin={canvasOrigin}
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

  const start = useSharedValue<Transform>(el.transform);
  // 最新の transform を SharedValue 経由で参照することで、pan の useMemo 依存から
  // 変化する値を外す。SharedValue オブジェクト自体は安定した参照なので deps に
  // 含めても Gesture.Pan インスタンスは再生成されない。これにより
  // setElementTransformLive でドラッグ中に el.transform が変わっても、
  // ジェスチャが中断されない。
  // ref ではなく SharedValue にするのは、ジェスチャコールバックから ref を
  // 触ると React Compiler 系 lint（react/refs）に引っかかるため。
  const latestTransform = useSharedValue<Transform>(el.transform);
  useEffect(() => {
    latestTransform.set(el.transform);
  });

  const tap = useMemo(() => Gesture.Tap().onEnd(() => onSelect()), [onSelect]);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(isSelected)
        .onStart(() => {
          start.set(latestTransform.value);
        })
        .onUpdate((e) => {
          const nx = clamp01(start.value.x + e.translationX / canvasSize.width);
          const ny = clamp01(
            start.value.y + e.translationY / canvasSize.height,
          );
          onTransform({ ...start.value, x: nx, y: ny });
        })
        .onEnd(() => {
          onCommit?.();
        }),
    [
      isSelected,
      canvasSize.width,
      canvasSize.height,
      start,
      latestTransform,
      onTransform,
      onCommit,
    ],
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
