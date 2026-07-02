import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import { View } from "react-native";
import type { ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { MeishiElement, Transform } from "@/lib/meishi/types";

type CanvasOrigin = { x: number; y: number };

type Size = { width: number; height: number };
type Corner = "tl" | "tr" | "bl" | "br";

const HANDLE_SIZE = 20;
const ROTATE_OFFSET = 32;
const MIN_W = 0.02;
const MIN_H = 0.02;

export function SelectionOverlay({
  element,
  canvasSize,
  canvasOriginRef,
  onTransform,
  onCommit,
}: {
  element: MeishiElement;
  canvasSize: Size;
  /** キャンバスの画面上絶対原点（measureInWindow 結果）。回転を絶対座標基準で扱うのに使う。 */
  canvasOriginRef?: MutableRefObject<CanvasOrigin>;
  onTransform: (t: Transform) => void;
  onCommit?: () => void;
}) {
  const t = element.transform;
  const boxW = t.width * canvasSize.width;
  const boxH = t.height * canvasSize.height;
  const x = t.x * canvasSize.width;
  const y = t.y * canvasSize.height;

  // 最新値を ref で参照することで、ジェスチャ中に element.transform が変わっても
  // Gesture インスタンスが再生成されず、ジェスチャが中断されない。
  const start = useRef<Transform>(t);
  const latestTransformRef = useRef<Transform>(t);
  latestTransformRef.current = t;

  const canvasWRef = useRef<number>(canvasSize.width);
  const canvasHRef = useRef<number>(canvasSize.height);
  canvasWRef.current = canvasSize.width;
  canvasHRef.current = canvasSize.height;

  // Gesture インスタンス生成用のファクトリ。fresh な useMemo で1度だけ作る。
  const buildResize = useCallback(
    (corner: Corner) =>
      Gesture.Pan()
        .onStart(() => {
          start.current = latestTransformRef.current;
        })
        .onUpdate((e) => {
          const dxN = e.translationX / canvasWRef.current;
          const dyN = e.translationY / canvasHRef.current;
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
        .onEnd(() => onCommit?.()),
    [onTransform, onCommit],
  );

  const resizeTl = useMemo(() => buildResize("tl"), [buildResize]);
  const resizeTr = useMemo(() => buildResize("tr"), [buildResize]);
  const resizeBl = useMemo(() => buildResize("bl"), [buildResize]);
  const resizeBr = useMemo(() => buildResize("br"), [buildResize]);

  const rotate = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          start.current = latestTransformRef.current;
        })
        .onUpdate((e) => {
          const s = start.current;
          // 中心（キャンバスローカル px）
          const cx = (s.x + s.width / 2) * canvasWRef.current;
          const cy = (s.y + s.height / 2) * canvasHRef.current;
          // キャンバスの画面絶対原点を差し引くことで、ポインタの absoluteX/Y を
          // キャンバスローカル px に変換する。canvasOriginRef が渡っていない場合は
          // 原点(0,0)としてフォールバック（回転済み要素だとズレる可能性はある）。
          const originX = canvasOriginRef?.current.x ?? 0;
          const originY = canvasOriginRef?.current.y ?? 0;
          const nowPx = e.absoluteX - originX;
          const nowPy = e.absoluteY - originY;
          const startPx = nowPx - e.translationX;
          const startPy = nowPy - e.translationY;
          const startAngle = Math.atan2(startPy - cy, startPx - cx);
          const nowAngle = Math.atan2(nowPy - cy, nowPx - cx);
          const deltaDeg = ((nowAngle - startAngle) * 180) / Math.PI;
          const nextRotation = (s.rotation + deltaDeg + 360) % 360;
          onTransform({ ...s, rotation: nextRotation });
        })
        .onEnd(() => onCommit?.()),
    [canvasOriginRef, onTransform, onCommit],
  );

  // 移動ジェスチャ（選択枠の中央部分をドラッグ）
  const move = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          start.current = latestTransformRef.current;
        })
        .onUpdate((e) => {
          const s = start.current;
          const nx = clamp01(s.x + e.translationX / canvasWRef.current);
          const ny = clamp01(s.y + e.translationY / canvasHRef.current);
          onTransform({ ...s, x: nx, y: ny });
        })
        .onEnd(() => onCommit?.()),
    [onTransform, onCommit],
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
          accessibilityLabel="要素を移動"
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
      <ResizeHandle corner="tl" gesture={resizeTl} />
      <ResizeHandle corner="tr" gesture={resizeTr} />
      <ResizeHandle corner="bl" gesture={resizeBl} />
      <ResizeHandle corner="br" gesture={resizeBr} />

      {/* 上辺外側の回転ハンドル */}
      <GestureDetector gesture={rotate}>
        <View
          accessibilityLabel="要素を回転"
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
  const cornerLabel: Record<Corner, string> = {
    tl: "左上",
    tr: "右上",
    bl: "左下",
    br: "右下",
  };
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
      <View
        style={pos}
        accessibilityLabel={`サイズ変更ハンドル（${cornerLabel[corner]}）`}
      />
    </GestureDetector>
  );
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
function clampMin(v: number, min: number): number {
  return Math.max(min, Math.min(1, v));
}
