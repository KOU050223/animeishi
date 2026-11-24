import { useCallback, useEffect, useMemo } from "react";
import { View } from "react-native";
import type { ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSharedValue, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useTranslation } from "react-i18next";
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
  canvasOrigin,
  onTransform,
  onCommit,
}: {
  element: MeishiElement;
  canvasSize: Size;
  /** キャンバスの画面上絶対原点（measureInWindow 結果）。回転を絶対座標基準で扱うのに使う。 */
  canvasOrigin?: SharedValue<CanvasOrigin> | undefined;
  onTransform: (t: Transform) => void;
  onCommit?: (() => void) | undefined;
}) {
  const { t: tr } = useTranslation();
  const t = element.transform;
  const boxW = t.width * canvasSize.width;
  const boxH = t.height * canvasSize.height;
  const x = t.x * canvasSize.width;
  const y = t.y * canvasSize.height;

  // 最新値を SharedValue で参照することで、ジェスチャ中に element.transform が
  // 変わっても Gesture インスタンスが再生成されず、ジェスチャが中断されない。
  // ref ではなく SharedValue にするのは、ジェスチャコールバックから ref を
  // 触ると React Compiler 系 lint（react/refs）に引っかかるため。
  const start = useSharedValue<Transform>(t);
  const latestTransform = useSharedValue<Transform>(t);
  const canvasW = useSharedValue<number>(canvasSize.width);
  const canvasH = useSharedValue<number>(canvasSize.height);
  useEffect(() => {
    latestTransform.set(t);
    canvasW.set(canvasSize.width);
    canvasH.set(canvasSize.height);
  });

  // Gesture インスタンス生成用のファクトリ。fresh な useMemo で1度だけ作る。
  // ジェスチャのコールバックは UI スレッドの worklet で実行されるため、
  // JS 側の関数（onTransform / onCommit）は scheduleOnRN 経由で呼ぶ
  // （直接呼ぶとクラッシュする）。
  const buildResize = useCallback(
    (corner: Corner) =>
      Gesture.Pan()
        .onStart(() => {
          start.set(latestTransform.value);
        })
        .onUpdate((e) => {
          const dxN = e.translationX / canvasW.value;
          const dyN = e.translationY / canvasH.value;
          const s = start.value;
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
          scheduleOnRN(onTransform, {
            ...s,
            x: nx,
            y: ny,
            width: nw,
            height: nh,
          });
        })
        .onEnd(() => {
          if (onCommit) scheduleOnRN(onCommit);
        }),
    [start, latestTransform, canvasW, canvasH, onTransform, onCommit],
  );

  // GestureDetector へ渡すジェスチャなので参照を固定する。
  const resizeTl = useMemo(() => buildResize("tl"), [buildResize]);
  const resizeTr = useMemo(() => buildResize("tr"), [buildResize]);
  const resizeBl = useMemo(() => buildResize("bl"), [buildResize]);
  const resizeBr = useMemo(() => buildResize("br"), [buildResize]);

  // GestureDetector へ渡すジェスチャなので参照を固定する。
  const rotate = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          start.set(latestTransform.value);
        })
        .onUpdate((e) => {
          const s = start.value;
          // 中心（キャンバスローカル px）
          const cx = (s.x + s.width / 2) * canvasW.value;
          const cy = (s.y + s.height / 2) * canvasH.value;
          // キャンバスの画面絶対原点を差し引くことで、ポインタの absoluteX/Y を
          // キャンバスローカル px に変換する。canvasOrigin が渡っていない場合は
          // 原点(0,0)としてフォールバック（回転済み要素だとズレる可能性はある）。
          const originX = canvasOrigin?.value.x ?? 0;
          const originY = canvasOrigin?.value.y ?? 0;
          const nowPx = e.absoluteX - originX;
          const nowPy = e.absoluteY - originY;
          const startPx = nowPx - e.translationX;
          const startPy = nowPy - e.translationY;
          const startAngle = Math.atan2(startPy - cy, startPx - cx);
          const nowAngle = Math.atan2(nowPy - cy, nowPx - cx);
          const deltaDeg = ((nowAngle - startAngle) * 180) / Math.PI;
          const nextRotation = (s.rotation + deltaDeg + 360) % 360;
          scheduleOnRN(onTransform, { ...s, rotation: nextRotation });
        })
        .onEnd(() => {
          if (onCommit) scheduleOnRN(onCommit);
        }),
    [
      canvasOrigin,
      start,
      latestTransform,
      canvasW,
      canvasH,
      onTransform,
      onCommit,
    ],
  );

  // 移動ジェスチャ（選択枠の中央部分をドラッグ）。
  // GestureDetector へ渡すため参照を固定する。
  const move = useMemo(
    () =>
      Gesture.Pan()
        .onStart(() => {
          start.set(latestTransform.value);
        })
        .onUpdate((e) => {
          const s = start.value;
          const nx = clamp01(s.x + e.translationX / canvasW.value);
          const ny = clamp01(s.y + e.translationY / canvasH.value);
          scheduleOnRN(onTransform, { ...s, x: nx, y: ny });
        })
        .onEnd(() => {
          if (onCommit) scheduleOnRN(onCommit);
        }),
    [start, latestTransform, canvasW, canvasH, onTransform, onCommit],
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
          accessibilityLabel={tr("要素を移動")}
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
          accessibilityLabel={tr("要素を回転")}
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
  const { t } = useTranslation();
  const offset = -HANDLE_SIZE / 2;
  const cornerLabel: Record<Corner, string> = {
    tl: t("左上"),
    tr: t("右上"),
    bl: t("左下"),
    br: t("右下"),
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
        accessibilityLabel={t("サイズ変更ハンドル（{{corner}}）", {
          corner: cornerLabel[corner],
        })}
      />
    </GestureDetector>
  );
}

function clamp01(v: number): number {
  "worklet";
  return Math.min(1, Math.max(0, v));
}
function clampMin(v: number, min: number): number {
  "worklet";
  return Math.max(min, Math.min(1, v));
}
