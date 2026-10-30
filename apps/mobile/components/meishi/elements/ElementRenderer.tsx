import { Image, Text, View } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";
import QRCode from "react-native-qrcode-svg";
import type {
  AnimeCollageElement,
  AnimeCountBadgeElement,
  ImageElement,
  MeishiElement,
  MeishiRenderContext,
  QrElement,
  ShapeElement,
  TextElement,
} from "@/lib/meishi/types";

function resolveFontFamily(
  family: TextElement["fontFamily"],
): string | undefined {
  // フォント組み込みは Phase 12。現状は system 相当で描画する。
  switch (family) {
    case "system":
    default:
      return undefined;
  }
}

function fontWeightToRn(w: TextElement["fontWeight"]): "400" | "700" | "900" {
  return w === "black" ? "900" : w === "bold" ? "700" : "400";
}

function resolveTextValue(el: TextElement, ctx: MeishiRenderContext): string {
  switch (el.source) {
    case "username":
      return ctx.profile.username ?? el.text;
    case "bio":
      return ctx.profile.bio ?? el.text;
    case "favoriteQuote":
      return ctx.profile.favoriteQuote ?? el.text;
    case "custom":
    default:
      return el.text;
  }
}

function resolveImageUri(
  el: ImageElement,
  ctx: MeishiRenderContext,
): string | null {
  switch (el.source) {
    case "avatar":
      return ctx.profile.profileImageUrl ?? null;
    case "anime":
    case "upload":
    default:
      return el.uri || null;
  }
}

function resolveQrData(el: QrElement, ctx: MeishiRenderContext): string {
  if (el.source === "profile") {
    return ctx.profile.profileUrl ?? "";
  }
  return el.data;
}

function TextRender({
  el,
  ctx,
  boxWidth,
  boxHeight,
  renderScale,
}: {
  el: TextElement;
  ctx: MeishiRenderContext;
  boxWidth: number;
  boxHeight: number;
  renderScale: number;
}) {
  const value = resolveTextValue(el, ctx);
  return (
    <View
      style={{
        width: boxWidth,
        height: boxHeight,
        justifyContent: "center",
      }}
    >
      <Text
        style={{
          fontSize: el.fontSize * renderScale,
          fontFamily: resolveFontFamily(el.fontFamily),
          fontWeight: fontWeightToRn(el.fontWeight),
          fontStyle: el.fontStyle,
          color: el.color,
          textAlign: el.align,
        }}
        numberOfLines={4}
      >
        {value}
      </Text>
    </View>
  );
}

function ImageRender({
  el,
  ctx,
  boxWidth,
  boxHeight,
  renderScale,
}: {
  el: ImageElement;
  ctx: MeishiRenderContext;
  boxWidth: number;
  boxHeight: number;
  renderScale: number;
}) {
  const uri = resolveImageUri(el, ctx);
  const borderRadius =
    el.shape === "circle"
      ? Math.min(boxWidth, boxHeight) / 2
      : el.shape === "rounded"
        ? 12 * renderScale
        : 0;

  if (!uri) {
    return (
      <View
        style={{
          width: boxWidth,
          height: boxHeight,
          borderRadius,
          backgroundColor: "#e2e8f0",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ color: "#94a3b8", fontSize: 10 }}>画像</Text>
      </View>
    );
  }

  return (
    <View
      style={{
        width: boxWidth,
        height: boxHeight,
        borderRadius,
        overflow: "hidden",
      }}
    >
      <Image
        source={{ uri }}
        style={{ width: "100%", height: "100%" }}
        resizeMode={el.objectFit}
      />
    </View>
  );
}

function ShapeRender({
  el,
  boxWidth,
  boxHeight,
  renderScale,
}: {
  el: ShapeElement;
  boxWidth: number;
  boxHeight: number;
  renderScale: number;
}) {
  const strokeWidth = el.strokeWidth * renderScale;
  if (el.shape === "circle") {
    return (
      <Svg width={boxWidth} height={boxHeight}>
        <Circle
          cx={boxWidth / 2}
          cy={boxHeight / 2}
          r={Math.min(boxWidth, boxHeight) / 2 - strokeWidth / 2}
          fill={el.fill}
          stroke={el.stroke}
          strokeWidth={strokeWidth}
        />
      </Svg>
    );
  }
  return (
    <Svg width={boxWidth} height={boxHeight}>
      <Rect
        x={strokeWidth / 2}
        y={strokeWidth / 2}
        width={boxWidth - strokeWidth}
        height={boxHeight - strokeWidth}
        rx={el.cornerRadius * renderScale}
        ry={el.cornerRadius * renderScale}
        fill={el.fill}
        stroke={el.stroke}
        strokeWidth={strokeWidth}
      />
    </Svg>
  );
}

function QrRender({
  el,
  ctx,
  boxWidth,
  boxHeight,
  renderScale,
}: {
  el: QrElement;
  ctx: MeishiRenderContext;
  boxWidth: number;
  boxHeight: number;
  renderScale: number;
}) {
  const size = Math.min(boxWidth, boxHeight);
  const padding = 4 * renderScale;
  const data = resolveQrData(el, ctx);
  return (
    <View
      style={{
        width: boxWidth,
        height: boxHeight,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: el.bgColor,
      }}
    >
      {data ? (
        <QRCode
          value={data}
          size={Math.max(1, size - padding)}
          color={el.fgColor}
          backgroundColor={el.bgColor}
        />
      ) : (
        <Text style={{ color: "#94a3b8", fontSize: 10 }}>QR</Text>
      )}
    </View>
  );
}

// コラージュに使う画像 URL を要素のリスト設定から解決する（issue #96）。
// listSource 未設定（旧ドキュメント）は「自動」= 従来どおり
// ctx.animeCollageImages（視聴履歴 → 空ならお気に入り）にフォールバックする。
function resolveCollageImages(
  el: AnimeCollageElement,
  ctx: MeishiRenderContext,
): string[] {
  const lists = ctx.animeLists;
  const legacy = ctx.animeCollageImages ?? [];
  // animeLists を持たない古い呼び出し側では従来リストへフォールバックする。
  // animeLists がある場合は選択したリストがそのまま結果になる（空リストは
  // 空として返す。legacy へ逃がすと別ステータスの作品が混入するため）。
  if (!lists) return legacy;
  if (el.listSource === "favorites") return lists.favorites;
  const state = el.state;
  if (state && state !== "all") return lists.byState[state] ?? [];
  if (el.listSource === "watchHistory") return lists.watchHistory;
  return legacy;
}

function AnimeCollageRender({
  el,
  ctx,
  boxWidth,
  boxHeight,
  renderScale,
}: {
  el: AnimeCollageElement;
  ctx: MeishiRenderContext;
  boxWidth: number;
  boxHeight: number;
  renderScale: number;
}) {
  const images = resolveCollageImages(el, ctx).slice(0, el.cols * el.rows);
  const gapPx = el.gap * boxWidth;
  const cellW = (boxWidth - gapPx * (el.cols - 1)) / el.cols;
  const cellH = (boxHeight - gapPx * (el.rows - 1)) / el.rows;

  return (
    <View
      style={{
        width: boxWidth,
        height: boxHeight,
        flexDirection: "row",
        flexWrap: "wrap",
        gap: gapPx,
      }}
    >
      {Array.from({ length: el.cols * el.rows }).map((_, i) => {
        const uri = images[i];
        return (
          <View
            key={i}
            style={{
              width: cellW,
              height: cellH,
              backgroundColor: "#e2e8f0",
              overflow: "hidden",
              borderRadius: 4 * renderScale,
            }}
          >
            {uri ? (
              <Image
                source={{ uri }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
              />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function AnimeCountBadgeRender({
  el,
  ctx,
  boxWidth,
  boxHeight,
  renderScale,
}: {
  el: AnimeCountBadgeElement;
  ctx: MeishiRenderContext;
  boxWidth: number;
  boxHeight: number;
  renderScale: number;
}) {
  const count =
    el.metric === "watched"
      ? (ctx.watchedCount ?? 0)
      : (ctx.favoritesCount ?? 0);
  return (
    <View
      style={{
        width: boxWidth,
        height: boxHeight,
        borderRadius: boxHeight / 2,
        backgroundColor: el.bgColor,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 8 * renderScale,
      }}
    >
      <Text
        style={{
          fontSize: el.fontSize * renderScale,
          fontWeight: fontWeightToRn(el.fontWeight),
          fontFamily: resolveFontFamily(el.fontFamily),
          color: el.color,
        }}
        numberOfLines={1}
      >
        {`${el.prefix}${count}${el.suffix}`}
      </Text>
    </View>
  );
}

export function ElementRenderer({
  element,
  ctx,
  boxWidth,
  boxHeight,
  renderScale = 1,
}: {
  element: MeishiElement;
  ctx: MeishiRenderContext;
  boxWidth: number;
  boxHeight: number;
  renderScale?: number;
}) {
  switch (element.type) {
    case "text":
      return (
        <TextRender
          el={element}
          ctx={ctx}
          boxWidth={boxWidth}
          boxHeight={boxHeight}
          renderScale={renderScale}
        />
      );
    case "image":
      return (
        <ImageRender
          el={element}
          ctx={ctx}
          boxWidth={boxWidth}
          boxHeight={boxHeight}
          renderScale={renderScale}
        />
      );
    case "shape":
      return (
        <ShapeRender
          el={element}
          boxWidth={boxWidth}
          boxHeight={boxHeight}
          renderScale={renderScale}
        />
      );
    case "qr":
      return (
        <QrRender
          el={element}
          ctx={ctx}
          boxWidth={boxWidth}
          boxHeight={boxHeight}
          renderScale={renderScale}
        />
      );
    case "animeCollage":
      return (
        <AnimeCollageRender
          el={element}
          ctx={ctx}
          boxWidth={boxWidth}
          boxHeight={boxHeight}
          renderScale={renderScale}
        />
      );
    case "animeCountBadge":
      return (
        <AnimeCountBadgeRender
          el={element}
          ctx={ctx}
          boxWidth={boxWidth}
          boxHeight={boxHeight}
          renderScale={renderScale}
        />
      );
  }
}
