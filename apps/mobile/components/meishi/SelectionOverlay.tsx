import { useMemo, useRef } from "react";
import { View } from "react-native";
import type { ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { MeishiElement, Transform } from "@/lib/meishi/types";

type Size = { width: number; height: number };
type Corner = "tl" | "tr" | "bl" | "br";

const HANDLE_SIZE = 20;
const ROTATE_OFFSET = 32;
const MIN_W = 0.02;
const MIN_H = 0.02;

export function SelectionOverlay({
  element,
  canvasSize,
  onTransform,
  onCommit,
}: {
  element: MeishiElement;
  canvasSize: Size;
  onTransform: (t: Transform) => void;
  onCommit?: () => void;
}) {
  const t = element.transform;
  const boxW = t.width * canvasSize.width;
  const boxH = t.height * canvasSize.height;
  const x = t.x * canvasSize.width;
  const y = t.y * canvasSize.height;

  const start = useRef<Transform>(t);

  const makeResize = (corner: Corner) =>
    Gesture.Pan()
      .onStart(() => {
        start.current = t;
      })
      .onUpdate((e) => {
        const dxN = e.translationX / canvasSize.width;
        const dyN = e.translationY / canvasSize.height;
        const s = start.current;
        let nx = s.x;
        let ny = s.y;
        let nw = s.width;
        let nh = s.height;
        switch (corner) {
          case "br":
            nw = clampMin(s.width + dxN, MIN_W);
            nh = clampMin(s.height + dyN, MIN_H);
            break;
          case "bl":
            nw = clampMin(s.width - dxN, MIN_W);
            nh = clampMin(s.height + dyN, MIN_H);
            nx = clamp01(s.x + (s.width - nw));
            break;
          case "tr":
            nw = clampMin(s.width + dxN, MIN_W);
            nh = clampMin(s.height - dyN, MIN_H);
            ny = clamp01(s.y + (s.height - nh));
            break;
          case "tl":
            nw = clampMin(s.width - dxN, MIN_W);
            nh = clampMin(s.height - dyN, MIN_H);
            nx = clamp01(s.x + (s.width - nw));
            ny = clamp01(s.y + (s.height - nh));
            break;
        }
        onTransform({ ...s, x: nx, y: ny, width: nw, height: nh });
      })
      .onEnd(() => onCommit?.());

  const rotate = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          start.current = t;
        })
        .onUpdate((e) => {
          const s = start.current;
          const cxPx = (s.x + s.width / 2) * canvasSize.width;
          const cyPx = (s.y + s.height / 2) * canvasSize.height;
          // 開始基準の上部中点
          const startHandleX = cxPx;
          const startHandleY = (s.y * canvasSize.height) - ROTATE_OFFSET;
          const nowX = startHandleX + e.translationX;
          const nowY = startHandleY + e.translationY;
          const startAngle = Math.atan2(startHandleY - cyPx, startHandleX - cxPx);
          const nowAngle = Math.atan2(nowY - cyPx, nowX - cxPx);
          const deltaDeg = ((nowAngle - startAngle) * 180) / Math.PI;
          const nextRotation = (s.rotation + deltaDeg + 360) % 360;
          onTransform({ ...s, rotation: nextRotation });
        })
        .onEnd(() => onCommit?.()),
    [t, canvasSize.width, canvasSize.height, onTransform, onCommit],
  );

  // 移動ジェスチャ（選択枠の中央部分をドラッグ）
  const move = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          start.current = t;
        })
        .onUpdate((e) => {
          const s = start.current;
          const nx = clamp01(s.x + e.translationX / canvasSize.width);
          const ny = clamp01(s.y + e.translationY / canvasSize.height);
          onTransform({ ...s, x: nx, y: ny });
        })
        .onEnd(() => onCommit?.()),
    [t, canvasSize.width, canvasSize.height, onTransform, onCommit],
  );

  return (
    <View
      pointerEvents="box-none"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: boxW,
        height: boxH,
        transform: [{ rotate: `${t.rotation}deg` }],
      }}
    >
      {/* 移動用の透明ハンドル（枠内） */}
      <GestureDetector gesture={move}>
        <View
          style={{
            position: "absolute",
            inset: 0,
            borderWidth: 1.5,
            borderColor: "#4f46e5",
            borderStyle: "dashed",
          }}
        />
      </GestureDetector>

      {/* 4隅のリサイズハンドル */}
      <ResizeHandle corner="tl" gesture={makeResize("tl")} />
      <ResizeHandle corner="tr" gesture={makeResize("tr")} />
      <ResizeHandle corner="bl" gesture={makeResize("bl")} />
      <ResizeHandle corner="br" gesture={makeResize("br")} />

      {/* 上辺外側の回転ハンドル */}
      <GestureDetector gesture={rotate}>
        <View
          style={{
            position: "absolute",
            left: boxW / 2 - HANDLE_SIZE / 2,
            top: -ROTATE_OFFSET - HANDLE_SIZE / 2,
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            borderRadius: HANDLE_SIZE / 2,
            backgroundColor: "#22c55e",
            borderWidth: 2,
            borderColor: "#ffffff",
          }}
        />
      </GestureDetector>
      {/* 回転ハンドルと枠を繋ぐ線 */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: boxW / 2 - 0.5,
          top: -ROTATE_OFFSET,
          width: 1,
          height: ROTATE_OFFSET,
          backgroundColor: "#4f46e5",
        }}
      />
    </View>
  );
}

function ResizeHandle({
  corner,
  gesture,
}: {
  corner: Corner;
  gesture: ReturnType<typeof Gesture.Pan>;
}) {
  const offset = -HANDLE_SIZE / 2;
  const pos: ViewStyle = {
    position: "absolute",
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: 4,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#4f46e5",
    ...(corner === "tl" ? { left: offset, top: offset } : {}),
    ...(corner === "tr" ? { right: offset, top: offset } : {}),
    ...(corner === "bl" ? { left: offset, bottom: offset } : {}),
    ...(corner === "br" ? { right: offset, bottom: offset } : {}),
  };
  return (
    <GestureDetector gesture={gesture}>
      <View style={pos} />
    </GestureDetector>
  );
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
function clampMin(v: number, min: number): number {
  return Math.max(min, Math.min(1, v));
}
