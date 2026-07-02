import { Pressable, ScrollView, Text, View } from "react-native";
import { COLOR_PALETTE, FONT_FAMILY_OPTIONS } from "@/lib/meishi/defaults";
import type {
  CollageSort,
  CountMetric,
  FontFamily,
  FontStyle,
  FontWeight,
  ImageObjectFit,
  ImageShape,
  MeishiElement,
  QrSource,
  ShapeKind,
  TextAlign,
  TextSource,
} from "@/lib/meishi/types";

type Props = {
  element: MeishiElement;
  onChange: (patch: Partial<MeishiElement>) => void;
  onOpenTextEdit: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onBringToFront: () => void;
  onSendToBack: () => void;
};

/**
 * 選択中要素のプロパティパネル。要素種別ごとに編集UIを出し分ける。
 */
export function PropertyPanel(props: Props) {
  const { element, onDelete, onDuplicate, onBringToFront, onSendToBack } = props;
  return (
    <View style={{ backgroundColor: "#ffffff", borderTopWidth: 1, borderTopColor: "#e5e7eb" }}>
      <ScrollView
        horizontal={false}
        style={{ maxHeight: 260 }}
        contentContainerStyle={{ padding: 12, gap: 12 }}
        showsVerticalScrollIndicator
      >
        <Text style={{ fontSize: 12, color: "#6b7280" }}>{typeLabel(element.type)}</Text>
        {renderEditor(props)}
      </ScrollView>
      <View
        style={{
          flexDirection: "row",
          borderTopWidth: 1,
          borderTopColor: "#e5e7eb",
          padding: 8,
          gap: 8,
        }}
      >
        <ActionButton label="↑最前" onPress={onBringToFront} />
        <ActionButton label="↓最背" onPress={onSendToBack} />
        <ActionButton label="複製" onPress={onDuplicate} />
        <ActionButton label="削除" onPress={onDelete} tint="#dc2626" />
      </View>
    </View>
  );
}

function renderEditor(props: Props) {
  const { element, onChange, onOpenTextEdit } = props;
  switch (element.type) {
    case "text":
      return (
        <>
          <Row label="文字列">
            <Pressable
              onPress={onOpenTextEdit}
              style={{
                flex: 1,
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderWidth: 1,
                borderColor: "#e5e7eb",
                borderRadius: 6,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text style={{ flex: 1 }} numberOfLines={1}>
                {element.source === "custom"
                  ? element.text
                  : `【${sourceLabel(element.source)}】`}
              </Text>
              <Text>✏️</Text>
            </Pressable>
          </Row>
          <Row label="内容">
            <SegmentedControl
              options={SOURCES}
              value={element.source}
              onChange={(v) => onChange({ source: v as TextSource } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="フォント">
            <SegmentedControl
              options={FONT_FAMILY_OPTIONS.map((f) => ({ value: f.value, label: f.label }))}
              value={element.fontFamily}
              onChange={(v) => onChange({ fontFamily: v as FontFamily } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="サイズ">
            <StepControl
              value={element.fontSize}
              onChange={(v) => onChange({ fontSize: Math.max(8, Math.min(200, v)) } as Partial<MeishiElement>)}
              step={2}
            />
          </Row>
          <Row label="太さ">
            <SegmentedControl
              options={[
                { value: "normal", label: "細" },
                { value: "bold", label: "太" },
                { value: "black", label: "極太" },
              ]}
              value={element.fontWeight}
              onChange={(v) => onChange({ fontWeight: v as FontWeight } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="斜体">
            <SegmentedControl
              options={[
                { value: "normal", label: "なし" },
                { value: "italic", label: "斜" },
              ]}
              value={element.fontStyle}
              onChange={(v) => onChange({ fontStyle: v as FontStyle } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="配置">
            <SegmentedControl
              options={[
                { value: "left", label: "左" },
                { value: "center", label: "中" },
                { value: "right", label: "右" },
              ]}
              value={element.align}
              onChange={(v) => onChange({ align: v as TextAlign } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="色">
            <ColorGrid
              value={element.color}
              onChange={(v) => onChange({ color: v } as Partial<MeishiElement>)}
            />
          </Row>
        </>
      );

    case "image":
      return (
        <>
          <Row label="形">
            <SegmentedControl
              options={[
                { value: "rect", label: "矩形" },
                { value: "rounded", label: "角丸" },
                { value: "circle", label: "円" },
              ]}
              value={element.shape}
              onChange={(v) => onChange({ shape: v as ImageShape } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="フィット">
            <SegmentedControl
              options={[
                { value: "cover", label: "cover" },
                { value: "contain", label: "contain" },
              ]}
              value={element.objectFit}
              onChange={(v) => onChange({ objectFit: v as ImageObjectFit } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="ソース">
            <Text style={{ color: "#6b7280", fontSize: 12 }}>
              {element.source === "avatar"
                ? "プロフィール画像を表示"
                : element.uri
                  ? "URL 設定済み"
                  : "URLは追加時に指定"}
            </Text>
          </Row>
        </>
      );

    case "shape":
      return (
        <>
          <Row label="形">
            <SegmentedControl
              options={[
                { value: "rectangle", label: "矩形" },
                { value: "circle", label: "円" },
              ]}
              value={element.shape}
              onChange={(v) => onChange({ shape: v as ShapeKind } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="塗り">
            <ColorGrid
              value={element.fill}
              onChange={(v) => onChange({ fill: v } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="枠色">
            <ColorGrid
              value={element.stroke}
              onChange={(v) => onChange({ stroke: v } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="枠幅">
            <StepControl
              value={element.strokeWidth}
              onChange={(v) => onChange({ strokeWidth: Math.max(0, Math.min(20, v)) } as Partial<MeishiElement>)}
              step={1}
            />
          </Row>
          {element.shape === "rectangle" ? (
            <Row label="角丸">
              <StepControl
                value={element.cornerRadius}
                onChange={(v) => onChange({ cornerRadius: Math.max(0, Math.min(60, v)) } as Partial<MeishiElement>)}
                step={2}
              />
            </Row>
          ) : null}
        </>
      );

    case "qr":
      return (
        <>
          <Row label="ソース">
            <SegmentedControl
              options={[
                { value: "profile", label: "プロフィールURL" },
                { value: "custom", label: "自由入力" },
              ]}
              value={element.source}
              onChange={(v) => onChange({ source: v as QrSource } as Partial<MeishiElement>)}
            />
          </Row>
          {element.source === "custom" ? (
            <Row label="内容">
              <Pressable
                onPress={onOpenTextEdit}
                style={{
                  flex: 1,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                  borderRadius: 6,
                }}
              >
                <Text numberOfLines={1}>{element.data || "タップして編集"}</Text>
              </Pressable>
            </Row>
          ) : null}
          <Row label="色">
            <ColorGrid value={element.fgColor} onChange={(v) => onChange({ fgColor: v } as Partial<MeishiElement>)} />
          </Row>
          <Row label="背景">
            <ColorGrid value={element.bgColor} onChange={(v) => onChange({ bgColor: v } as Partial<MeishiElement>)} />
          </Row>
        </>
      );

    case "animeCollage":
      return (
        <>
          <Row label="列">
            <StepControl
              value={element.cols}
              onChange={(v) => onChange({ cols: Math.max(1, Math.min(6, v)) } as Partial<MeishiElement>)}
              step={1}
            />
          </Row>
          <Row label="行">
            <StepControl
              value={element.rows}
              onChange={(v) => onChange({ rows: Math.max(1, Math.min(6, v)) } as Partial<MeishiElement>)}
              step={1}
            />
          </Row>
          <Row label="並び順">
            <SegmentedControl
              options={[
                { value: "recent", label: "新しい順" },
                { value: "popular", label: "人気順" },
              ]}
              value={element.sortBy}
              onChange={(v) => onChange({ sortBy: v as CollageSort } as Partial<MeishiElement>)}
            />
          </Row>
        </>
      );

    case "animeCountBadge":
      return (
        <>
          <Row label="種別">
            <SegmentedControl
              options={[
                { value: "watched", label: "視聴済" },
                { value: "favorites", label: "お気に入り" },
              ]}
              value={element.metric}
              onChange={(v) => onChange({ metric: v as CountMetric } as Partial<MeishiElement>)}
            />
          </Row>
          <Row label="サイズ">
            <StepControl
              value={element.fontSize}
              onChange={(v) => onChange({ fontSize: Math.max(8, Math.min(80, v)) } as Partial<MeishiElement>)}
              step={2}
            />
          </Row>
          <Row label="文字色">
            <ColorGrid value={element.color} onChange={(v) => onChange({ color: v } as Partial<MeishiElement>)} />
          </Row>
          <Row label="背景色">
            <ColorGrid value={element.bgColor} onChange={(v) => onChange({ bgColor: v } as Partial<MeishiElement>)} />
          </Row>
        </>
      );
  }
}

const SOURCES: { value: TextSource; label: string }[] = [
  { value: "custom", label: "自由" },
  { value: "username", label: "名前" },
  { value: "bio", label: "紹介" },
  { value: "favoriteQuote", label: "セリフ" },
];

function sourceLabel(s: TextSource): string {
  const found = SOURCES.find((x) => x.value === s);
  return found?.label ?? s;
}

function typeLabel(t: MeishiElement["type"]): string {
  switch (t) {
    case "text": return "テキスト";
    case "image": return "画像";
    case "shape": return "図形";
    case "qr": return "QR";
    case "animeCollage": return "視聴コラージュ";
    case "animeCountBadge": return "視聴数バッジ";
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 11, color: "#6b7280", fontWeight: "600" }}>{label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>{children}</View>
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
            onPress={() => onChange(opt.value)}
            style={{
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 6,
              backgroundColor: active ? "#4f46e5" : "#f3f4f6",
            }}
          >
            <Text style={{ color: active ? "#ffffff" : "#111827", fontSize: 12 }}>{opt.label}</Text>
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
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Pressable
        onPress={() => onChange(value - step)}
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          backgroundColor: "#e5e7eb",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 16 }}>−</Text>
      </Pressable>
      <Text style={{ minWidth: 32, textAlign: "center" }}>{Math.round(value)}</Text>
      <Pressable
        onPress={() => onChange(value + step)}
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          backgroundColor: "#e5e7eb",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text style={{ fontSize: 16 }}>＋</Text>
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
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {COLOR_PALETTE.map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            backgroundColor: c,
            borderWidth: c.toLowerCase() === value.toLowerCase() ? 2 : 1,
            borderColor: c.toLowerCase() === value.toLowerCase() ? "#4f46e5" : "#d1d5db",
          }}
        />
      ))}
    </ScrollView>
  );
}

function ActionButton({
  label,
  onPress,
  tint = "#111827",
}: {
  label: string;
  onPress: () => void;
  tint?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 10,
        borderRadius: 8,
        backgroundColor: "#f3f4f6",
        alignItems: "center",
      }}
    >
      <Text style={{ color: tint, fontWeight: "600", fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}
