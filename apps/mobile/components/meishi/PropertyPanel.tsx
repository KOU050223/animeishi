import {
  Pressable,
  ScrollView,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Image as ExpoImage } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { COLOR_PALETTE, FONT_FAMILY_OPTIONS } from "@/lib/meishi/defaults";
import Ionicons from "@expo/vector-icons/Ionicons";
import { haptics } from "@/lib/haptics";
import { useThemeColors } from "@/lib/theme";
import {
  dragImageFocus,
  imageContentPosition,
  nudgeImageFocus,
} from "@/lib/meishi/imageFocus";
import { resolveImageUri } from "@/lib/meishi/renderableImages";
import type { ThemeColors } from "@/lib/theme";
import type { TFunction } from "i18next";
import type { TranslationKey } from "@/lib/i18n/keys";
import type {
  CollageStateFilter,
  ImageElement,
  MeishiRenderContext,
  MeishiElement,
  TextSource,
} from "@/lib/meishi/types";

type Props = {
  element: MeishiElement;
  context?: MeishiRenderContext;
  canvasAspectRatio?: number;
  style?: StyleProp<ViewStyle>;
  onChange: (patch: Partial<MeishiElement>) => void;
  onOpenTextEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
  /** 画像要素の差し替え（issue #96: アニメ検索/端末アップロード） */
  onReplaceImage?: (kind: "anime" | "upload") => void;
};

/**
 * 選択中要素のプロパティパネル。要素種別ごとに編集UIを出し分ける。
 */
export function PropertyPanel(props: Props) {
  const colors = useThemeColors();
  const { t } = useTranslation();
  const sourceOptions = SOURCES.map((source) => ({
    ...source,
    label: t(source.label),
  }));
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const lastSelectedId = useRef<string | null>(null);
  const { element, onDelete, onDuplicate, onBringToFront, onSendToBack } =
    props;
  useEffect(() => {
    if (lastSelectedId.current === element.id) return;
    lastSelectedId.current = element.id;
    scrollRef.current?.scrollTo({
      y: element.type === "text" ? 80 : 0,
      animated: true,
    });
  }, [element.id, element.type]);
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        },
        props.style,
      ]}
    >
      <ScrollView
        ref={scrollRef}
        horizontal={false}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, gap: 12 }}
        showsVerticalScrollIndicator
      >
        <Text style={{ fontSize: 12, color: colors.textMuted }}>
          {typeLabel(element.type, t)}
        </Text>
        {renderEditor(
          props,
          colors,
          t,
          t("表示内容"),
          t(
            "自由は入力した文字、名前・紹介・セリフはプロフィールの内容を表示します",
          ),
          t("切り抜き位置"),
          sourceOptions,
        )}
      </ScrollView>
      <View
        style={{
          flexDirection: "row",
          borderTopWidth: 1,
          borderTopColor: colors.border,
          padding: 8,
          gap: 8,
        }}
      >
        <ActionButton label={t("↑最前")} onPress={onBringToFront} />
        <ActionButton label={t("↓最背")} onPress={onSendToBack} />
        <ActionButton label={t("複製")} onPress={onDuplicate} />
        <ActionButton
          label={t("削除")}
          onPress={onDelete}
          tint={colors.danger}
        />
      </View>
    </View>
  );
}

function ImageFocusPreview({
  element,
  context,
  canvasAspectRatio,
  onChange,
  colors,
}: {
  element: ImageElement;
  context?: MeishiRenderContext;
  canvasAspectRatio: number;
  onChange: Props["onChange"];
  colors: ThemeColors;
}) {
  const { t } = useTranslation();
  const uri = resolveImageUri(element, context ?? { profile: {} });
  const ratio = Math.max(
    0.1,
    (element.transform.width * canvasAspectRatio) /
      Math.max(element.transform.height, 0.001),
  );
  const frame = useMemo(
    () => ({
      width: Math.min(160, 120 * ratio),
      height: Math.min(120, 160 / ratio),
    }),
    [ratio],
  );
  const [imageSize, setImageSize] = useState<{
    uri: string;
    width: number;
    height: number;
  } | null>(null);
  const loadedImageSize = imageSize?.uri === uri ? imageSize : null;
  const [previewFocus, setPreviewFocus] = useState<{
    id: string;
    focus: NonNullable<ImageElement["focus"]>;
  } | null>(null);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .onUpdate((event) => {
          if (!loadedImageSize) return;
          setPreviewFocus({
            id: element.id,
            focus: dragImageFocus(
              element.focus,
              { x: event.translationX, y: event.translationY },
              frame,
              loadedImageSize,
            ),
          });
        })
        .onEnd((event) => {
          if (!loadedImageSize) return;
          onChange({
            focus: dragImageFocus(
              element.focus,
              { x: event.translationX, y: event.translationY },
              frame,
              loadedImageSize,
            ),
          });
          setPreviewFocus(null);
        })
        .onFinalize(() => setPreviewFocus(null)),
    [element.id, element.focus, frame, loadedImageSize, onChange],
  );

  // ドラッグはスイッチ操作・VoiceOver・Web のキーボード操作では使えないため、
  // 一定量ずつ焦点をずらす手段をカスタムアクションとボタンの両方で用意する。
  const focusActions = [
    {
      name: "left",
      label: t("表示位置を左へ"),
      icon: "arrow-back",
      delta: { x: -0.1, y: 0 },
    },
    {
      name: "right",
      label: t("表示位置を右へ"),
      icon: "arrow-forward",
      delta: { x: 0.1, y: 0 },
    },
    {
      name: "up",
      label: t("表示位置を上へ"),
      icon: "arrow-up",
      delta: { x: 0, y: -0.1 },
    },
    {
      name: "down",
      label: t("表示位置を下へ"),
      icon: "arrow-down",
      delta: { x: 0, y: 0.1 },
    },
  ] as const;
  const currentFocus = element.focus ?? { x: 0.5, y: 0.5 };

  if (!uri) return null;
  return (
    <View style={{ alignItems: "flex-start", gap: 6 }}>
      <GestureDetector gesture={pan}>
        <View
          testID="meishi-image-focus-preview"
          accessible
          accessibilityLabel={t("切り抜き位置")}
          accessibilityHint={t("画像をドラッグして表示位置を調整")}
          accessibilityValue={{
            text: t("横 {{x}}%、縦 {{y}}%", {
              x: Math.round(currentFocus.x * 100),
              y: Math.round(currentFocus.y * 100),
            }),
          }}
          accessibilityActions={focusActions.map(({ name, label }) => ({
            name,
            label,
          }))}
          onAccessibilityAction={(event) => {
            const action = focusActions.find(
              (a) => a.name === event.nativeEvent.actionName,
            );
            if (action)
              onChange({ focus: nudgeImageFocus(element.focus, action.delta) });
          }}
          style={{
            width: frame.width,
            height: frame.height,
            overflow: "hidden",
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius:
              element.shape === "circle"
                ? Math.min(frame.width, frame.height) / 2
                : element.shape === "rounded"
                  ? 8
                  : 0,
          }}
        >
          <ExpoImage
            source={{ uri }}
            style={{ width: "100%", height: "100%" }}
            // web ではネイティブ画像ドラッグが Pan を pointercancel で切る（issue #327）
            draggable={false}
            contentFit="cover"
            contentPosition={imageContentPosition(
              previewFocus?.id === element.id
                ? previewFocus.focus
                : element.focus,
            )}
            onLoad={(event) =>
              setImageSize({
                uri,
                width: event.source.width,
                height: event.source.height,
              })
            }
          />
        </View>
      </GestureDetector>
      <Text style={{ color: colors.textMuted, fontSize: 11 }}>
        {t("画像をドラッグして表示位置を調整")}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        {focusActions.map(({ name, label, icon, delta }) => (
          <Pressable
            key={name}
            testID={`meishi-image-focus-${name}`}
            accessibilityRole="button"
            accessibilityLabel={label}
            hitSlop={6}
            onPress={() =>
              onChange({ focus: nudgeImageFocus(element.focus, delta) })
            }
            style={{ padding: 4 }}
          >
            <Ionicons name={icon} size={16} color={colors.primaryText} />
          </Pressable>
        ))}
        <Pressable
          onPress={() => onChange({ focus: { x: 0.5, y: 0.5 } })}
          accessibilityRole="button"
          style={{ marginLeft: 8 }}
        >
          <Text style={{ color: colors.primaryText, fontSize: 12 }}>
            {t("中央に戻す")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function renderEditor(
  props: Props,
  colors: ThemeColors,
  t: TFunction,
  contentLabel: string,
  contentHelp: string,
  focusLabel: string,
  sourceOptions: { value: TextSource; label: string }[],
) {
  const { element, onChange, onOpenTextEdit } = props;
  switch (element.type) {
    case "text":
      return (
        <>
          <Row label={t("文字列")}>
            <Pressable
              onPress={onOpenTextEdit}
              accessibilityRole="button"
              style={{
                flex: 1,
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 6,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>
                {resolveTextValue(element, props.context) ||
                  t("【{{label}}】", { label: t(sourceLabel(element.source)) })}
              </Text>
              <Ionicons name="pencil" size={14} color={colors.textMuted} />
            </Pressable>
          </Row>
          <Row label={contentLabel}>
            <SegmentedControl
              options={sourceOptions}
              value={element.source}
              onChange={(v) => onChange({ source: v })}
            />
          </Row>
          <Text style={{ fontSize: 11, color: colors.textMuted }}>
            {contentHelp}
          </Text>
          <Row label={t("フォント")}>
            <SegmentedControl
              options={FONT_FAMILY_OPTIONS.map((f) => ({
                value: f.value,
                label: t(f.label, { defaultValue: f.label }),
              }))}
              value={element.fontFamily}
              onChange={(v) =>
                onChange({
                  fontFamily: v,
                })
              }
            />
          </Row>
          <Row label={t("サイズ")}>
            <StepControl
              value={element.fontSize}
              onChange={(v) =>
                onChange({
                  fontSize: Math.max(8, Math.min(200, v)),
                })
              }
              step={2}
            />
          </Row>
          <Row label={t("太さ")}>
            <SegmentedControl
              options={[
                { value: "normal", label: t("細") },
                { value: "bold", label: t("太") },
                { value: "black", label: t("極太") },
              ]}
              value={element.fontWeight}
              onChange={(v) =>
                onChange({
                  fontWeight: v,
                })
              }
            />
          </Row>
          <Row label={t("斜体")}>
            <SegmentedControl
              options={[
                { value: "normal", label: t("なし") },
                { value: "italic", label: t("斜") },
              ]}
              value={element.fontStyle}
              onChange={(v) =>
                onChange({
                  fontStyle: v,
                })
              }
            />
          </Row>
          <Row label={t("配置")}>
            <SegmentedControl
              options={[
                { value: "left", label: t("左") },
                { value: "center", label: t("中") },
                { value: "right", label: t("右") },
              ]}
              value={element.align}
              onChange={(v) => onChange({ align: v })}
            />
          </Row>
          <Row label={t("色")}>
            <ColorGrid
              value={element.color}
              onChange={(v) => onChange({ color: v })}
            />
          </Row>
        </>
      );

    case "image":
      return (
        <>
          <Row label={t("形")}>
            <SegmentedControl
              options={[
                { value: "rect", label: t("矩形") },
                { value: "rounded", label: t("角丸") },
                { value: "circle", label: t("円") },
              ]}
              value={element.shape}
              onChange={(v) => onChange({ shape: v })}
            />
          </Row>
          <Row label={t("フィット")}>
            <SegmentedControl
              options={[
                { value: "cover", label: "cover" },
                { value: "contain", label: "contain" },
              ]}
              value={element.objectFit}
              onChange={(v) =>
                onChange({
                  objectFit: v,
                })
              }
            />
          </Row>
          {element.objectFit === "cover" ? (
            <Row label={focusLabel}>
              <ImageFocusPreview
                element={element}
                context={props.context}
                canvasAspectRatio={props.canvasAspectRatio ?? 1}
                onChange={onChange}
                colors={colors}
              />
            </Row>
          ) : null}
          <Row label={t("ソース")}>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>
              {element.source === "avatar"
                ? t("プロフィール画像を表示")
                : element.source === "anime"
                  ? t("アニメ画像")
                  : element.uri
                    ? t("アップロード済み")
                    : t("URLは追加時に指定")}
            </Text>
          </Row>
          {props.onReplaceImage ? (
            <Row label={t("差し替え")}>
              <ImagePickButton
                label={t("アニメから選ぶ")}
                onPress={() => props.onReplaceImage?.("anime")}
              />
              <ImagePickButton
                label={t("端末から選ぶ")}
                onPress={() => props.onReplaceImage?.("upload")}
              />
            </Row>
          ) : null}
        </>
      );

    case "shape":
      return (
        <>
          <Row label={t("形")}>
            <SegmentedControl
              options={[
                { value: "rectangle", label: t("矩形") },
                { value: "circle", label: t("円") },
              ]}
              value={element.shape}
              onChange={(v) => onChange({ shape: v })}
            />
          </Row>
          <Row label={t("塗り")}>
            <ColorGrid
              value={element.fill}
              onChange={(v) => onChange({ fill: v })}
            />
          </Row>
          <Row label={t("枠色")}>
            <ColorGrid
              value={element.stroke}
              onChange={(v) => onChange({ stroke: v })}
            />
          </Row>
          <Row label={t("枠幅")}>
            <StepControl
              value={element.strokeWidth}
              onChange={(v) =>
                onChange({
                  strokeWidth: Math.max(0, Math.min(20, v)),
                })
              }
              step={1}
            />
          </Row>
          {element.shape === "rectangle" ? (
            <Row label={t("角丸")}>
              <StepControl
                value={element.cornerRadius}
                onChange={(v) =>
                  onChange({
                    cornerRadius: Math.max(0, Math.min(60, v)),
                  })
                }
                step={2}
              />
            </Row>
          ) : null}
        </>
      );

    case "qr":
      return (
        <>
          <Row label={t("ソース")}>
            <SegmentedControl
              options={[
                { value: "profile", label: t("プロフィールURL") },
                { value: "custom", label: t("自由入力") },
              ]}
              value={element.source}
              onChange={(v) => onChange({ source: v })}
            />
          </Row>
          {element.source === "custom" ? (
            <Row label={t("内容")}>
              <Pressable
                onPress={onOpenTextEdit}
                accessibilityRole="button"
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 6,
                }}
              >
                <Text numberOfLines={1} style={{ color: colors.text }}>
                  {element.data || t("タップして編集")}
                </Text>
              </Pressable>
            </Row>
          ) : null}
          <Row label={t("色")}>
            <ColorGrid
              value={element.fgColor}
              onChange={(v) => onChange({ fgColor: v })}
            />
          </Row>
          <Row label={t("背景")}>
            <ColorGrid
              value={element.bgColor}
              onChange={(v) => onChange({ bgColor: v })}
            />
          </Row>
        </>
      );

    case "animeCollage":
      return (
        <>
          <Row label={t("列")}>
            <StepControl
              value={element.cols}
              onChange={(v) =>
                onChange({
                  cols: Math.max(1, Math.min(6, v)),
                })
              }
              step={1}
            />
          </Row>
          <Row label={t("行")}>
            <StepControl
              value={element.rows}
              onChange={(v) =>
                onChange({
                  rows: Math.max(1, Math.min(6, v)),
                })
              }
              step={1}
            />
          </Row>
          <Row label={t("並び順")}>
            <SegmentedControl
              options={[
                { value: "recent", label: t("新しい順") },
                { value: "popular", label: t("人気順") },
              ]}
              value={element.sortBy}
              onChange={(v) => onChange({ sortBy: v })}
            />
          </Row>
          <Row label={t("リスト")}>
            <SegmentedControl
              options={[
                { value: "auto", label: t("自動") },
                { value: "watchHistory", label: t("視聴履歴") },
                { value: "favorites", label: t("推し") },
              ]}
              value={element.listSource ?? "auto"}
              onChange={(v) => {
                if (v === "auto") {
                  onChange({ listSource: undefined });
                } else if (v === "favorites") {
                  // お気に入りにステータスは無いので、残っていると復活してしまう値を消す
                  onChange({ listSource: "favorites", state: undefined });
                } else {
                  onChange({ listSource: "watchHistory" });
                }
              }}
            />
          </Row>
          {element.listSource !== "favorites" ? (
            <Row label={t("ステータス")}>
              <SegmentedControl
                options={COLLAGE_STATE_OPTIONS.map((o) => ({
                  ...o,
                  label: t(o.label),
                }))}
                value={element.state ?? "all"}
                onChange={(v) =>
                  onChange({
                    state: v === "all" ? undefined : v,
                  })
                }
              />
            </Row>
          ) : null}
        </>
      );

    case "animeCountBadge":
      return (
        <>
          <Row label={t("種別")}>
            <SegmentedControl
              options={[
                { value: "watched", label: t("視聴済") },
                { value: "favorites", label: t("推し") },
              ]}
              value={element.metric}
              onChange={(v) => onChange({ metric: v })}
            />
          </Row>
          <Row label={t("サイズ")}>
            <StepControl
              value={element.fontSize}
              onChange={(v) =>
                onChange({
                  fontSize: Math.max(8, Math.min(80, v)),
                })
              }
              step={2}
            />
          </Row>
          <Row label={t("文字色")}>
            <ColorGrid
              value={element.color}
              onChange={(v) => onChange({ color: v })}
            />
          </Row>
          <Row label={t("背景色")}>
            <ColorGrid
              value={element.bgColor}
              onChange={(v) => onChange({ bgColor: v })}
            />
          </Row>
        </>
      );

    case "achievementBadge":
      return (
        <>
          <Row label={t("実績")}>
            <SegmentedControl
              options={[
                { value: "watch_count", label: t("視聴数") },
                { value: "record_streak", label: t("連続記録") },
                { value: "season_completion", label: t("今期完走") },
              ]}
              value={element.kind}
              onChange={(v) => onChange({ kind: v })}
            />
          </Row>
          <Row label={t("サイズ")}>
            <StepControl
              value={element.fontSize}
              onChange={(v) =>
                onChange({
                  fontSize: Math.max(8, Math.min(80, v)),
                })
              }
              step={2}
            />
          </Row>
          <Row label={t("文字色")}>
            <ColorGrid
              value={element.color}
              onChange={(v) => onChange({ color: v })}
            />
          </Row>
          <Row label={t("背景色")}>
            <ColorGrid
              value={element.bgColor}
              onChange={(v) => onChange({ bgColor: v })}
            />
          </Row>
        </>
      );
  }
}

const SOURCES: { value: TextSource; label: TranslationKey }[] = [
  { value: "custom", label: "自由" },
  { value: "username", label: "名前" },
  { value: "bio", label: "紹介" },
  { value: "favoriteQuote", label: "セリフ" },
];

// Annict の視聴ステータス（useWatchHistory の WATCH_STATUS_LABELS と同じ並び）。
// コラージュ要素の絞り込み用に「すべて」を先頭へ足したもの。
const COLLAGE_STATE_OPTIONS: {
  value: CollageStateFilter;
  label: TranslationKey;
}[] = [
  { value: "all", label: "すべて" },
  { value: "WATCHING", label: "視聴中" },
  { value: "WATCHED", label: "視聴済" },
  { value: "WANNA_WATCH", label: "視聴予定" },
  { value: "ON_HOLD", label: "一時停止" },
  { value: "STOP_WATCHING", label: "断念" },
];

function sourceLabel(s: TextSource): TranslationKey {
  const found = SOURCES.find((x) => x.value === s);
  return found?.label ?? (s as TranslationKey);
}

function resolveTextValue(
  element: Extract<MeishiElement, { type: "text" }>,
  context: MeishiRenderContext | undefined,
): string {
  switch (element.source) {
    case "username":
      return context?.profile.username ?? element.text;
    case "bio":
      return context?.profile.bio ?? element.text;
    case "favoriteQuote":
      return context?.profile.favoriteQuote ?? element.text;
    case "custom":
    default:
      return element.text;
  }
}

function typeLabel(type: MeishiElement["type"], t: TFunction): string {
  switch (type) {
    case "text":
      return t("テキスト");
    case "image":
      return t("画像");
    case "shape":
      return t("図形");
    case "qr":
      return "QR";
    case "animeCollage":
      return t("視聴コラージュ");
    case "animeCountBadge":
      return t("視聴数バッジ");
    case "achievementBadge":
      return t("実績バッジ");
  }
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: 4 }}>
      <Text
        style={{ fontSize: 11, color: colors.textMuted, fontWeight: "600" }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {children}
      </View>
    </View>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const colors = useThemeColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6 }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              if (!active) haptics.selection();
              onChange(opt.value);
            }}
            accessibilityRole="button"
            style={{
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 6,
              backgroundColor: active ? colors.primary : colors.surfaceMuted,
            }}
          >
            <Text
              style={{
                color: active ? colors.onPrimary : colors.text,
                fontSize: 12,
              }}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function StepControl({
  value,
  onChange,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  step: number;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable
        onPress={() => onChange(value - step)}
        accessibilityRole="button"
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          backgroundColor: colors.surfaceMuted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 16, color: colors.text }}>−</Text>
      </Pressable>
      <Text style={{ minWidth: 32, textAlign: "center", color: colors.text }}>
        {Math.round(value)}
      </Text>
      <Pressable
        onPress={() => onChange(value + step)}
        accessibilityRole="button"
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          backgroundColor: colors.surfaceMuted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 16, color: colors.text }}>＋</Text>
      </Pressable>
    </View>
  );
}

function ColorGrid({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const colors = useThemeColors();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6 }}
    >
      {COLOR_PALETTE.map((c) => {
        const selected = c.toLowerCase() === value.toLowerCase();
        return (
          <Pressable
            key={c}
            onPress={() => onChange(c)}
            accessibilityRole="button"
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              backgroundColor: c,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? colors.primaryBorder : colors.border,
              // 見本色と同系色の選択枠（indigo 見本など）でも選択状態が
              // 判別できるよう、間隔を空けた外側リングを足す。
              // border だけだと見本の塗りと同化する。
              outlineColor: colors.primaryBorder,
              outlineStyle: "solid",
              outlineWidth: selected ? 2 : 0,
              outlineOffset: 1,
            }}
          />
        );
      })}
    </ScrollView>
  );
}

function ImagePickButton({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        backgroundColor: colors.surfaceMuted,
        borderWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ fontSize: 12, color: colors.text }}>{label}</Text>
    </Pressable>
  );
}

function ActionButton({
  label,
  onPress,
  tint,
}: {
  label: string;
  onPress: () => void;
  tint?: string;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        flex: 1,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: colors.surfaceMuted,
        alignItems: "center",
      }}
    >
      <Text
        style={{ color: tint ?? colors.text, fontWeight: "600", fontSize: 12 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
