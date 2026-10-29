/**
 * @expo/ui（universal 層）のテスト用モック。
 *
 * jest.config.cjs の moduleNameMapper でテスト中は常にこのファイルが
 * @expo/ui の代わりに読み込まれる。本物はネイティブビュー
 * （SwiftUI / Jetpack Compose）を require するため jest では描画できない。
 * universal 層と同じコンポーネント構成を React Native ビューで再現し、
 * 画面テストがネイティブ差し替え後も同じ操作・検証を行えるようにする。
 *
 * MenuPicker が Picker に渡す testID は `{base}-button`、選択肢は
 * `{base}-option-{value}` という約束になっている（MenuPicker.web と同じ）。
 * このモックも同じ約束で選択肢の testID を組み立てる。
 */
import { useState } from "react";
import type { ReactNode } from "react";
import {
  Pressable,
  Switch as RNSwitch,
  ScrollView,
  Text as RNText,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

type AnyProps = Record<string, unknown> & { children?: ReactNode };

function findAccessibilityLabel(props: AnyProps): string | undefined {
  const modifiers = props.modifiers;
  if (!Array.isArray(modifiers)) return undefined;
  const found = modifiers.find(
    (m): m is { $type: string; label?: unknown } =>
      typeof m === "object" && m !== null && m.$type === "accessibilityLabel",
  );
  return typeof found?.label === "string" ? found.label : undefined;
}

export function Host({ children, ...props }: AnyProps) {
  return <View {...props}>{children}</View>;
}

export function Column(props: AnyProps) {
  return <View {...props} />;
}

export function Row(props: AnyProps) {
  return (
    <View
      {...props}
      style={[{ flexDirection: "row" }, props.style as StyleProp<ViewStyle>]}
    />
  );
}

export { ScrollView };

export function Spacer() {
  return <View style={{ flex: 1 }} />;
}

export function Text({ children, ...props }: AnyProps) {
  return <RNText {...props}>{children}</RNText>;
}

export function Button({ children, onPress, ...props }: AnyProps) {
  return (
    <Pressable {...props} onPress={onPress as () => void}>
      <RNText>{children}</RNText>
    </Pressable>
  );
}

export function Switch({ value, onValueChange, ...props }: AnyProps) {
  return (
    <RNSwitch
      {...props}
      value={value as boolean}
      onValueChange={onValueChange as (v: boolean) => void}
    />
  );
}

export function ListItem({ children, onPress, ...props }: AnyProps) {
  return (
    <Pressable
      {...props}
      onPress={onPress as () => void}
      accessibilityLabel={
        (props.accessibilityLabel as string) ?? findAccessibilityLabel(props)
      }
      accessibilityRole="button"
    >
      {typeof children === "string" ? <RNText>{children}</RNText> : children}
    </Pressable>
  );
}

function FieldSection({ children, title, ...props }: AnyProps) {
  return (
    <View {...props}>
      {typeof title === "string" ? <RNText>{title}</RNText> : null}
      {children}
    </View>
  );
}

export function FieldGroup({ children, ...props }: AnyProps) {
  return <View {...props}>{children}</View>;
}
FieldGroup.Section = FieldSection;
FieldGroup.SectionHeader = ({ children }: AnyProps) => <>{children}</>;
FieldGroup.SectionFooter = ({ children }: AnyProps) => <>{children}</>;

type PickerItemProps = { label: string; value: string | number };

function isPickerItem(
  node: ReactNode,
): node is React.ReactElement<PickerItemProps> {
  return (
    typeof node === "object" &&
    node !== null &&
    "props" in node &&
    typeof (node as { props: PickerItemProps }).props?.value !== "undefined"
  );
}

export function Picker({
  selectedValue,
  onValueChange,
  children,
  testID,
  enabled = true,
}: AnyProps) {
  const [open, setOpen] = useState(false);
  const nodes = Array.isArray(children) ? children : [children];
  const items = nodes.filter(isPickerItem).map((el) => el.props);
  const base = typeof testID === "string" ? testID.replace(/-button$/, "") : "";
  const selected = items.find((i) => i.value === selectedValue);

  return (
    <View>
      <Pressable
        testID={testID as string}
        accessibilityRole="button"
        disabled={!(enabled as boolean)}
        onPress={() => setOpen((o) => !o)}
      >
        <RNText>{selected?.label ?? ""}</RNText>
      </Pressable>
      {open
        ? items.map((item) => (
            <Pressable
              key={String(item.value)}
              testID={`${base}-option-${item.value}`}
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
                (onValueChange as ((v: string | number) => void) | undefined)?.(
                  item.value,
                );
              }}
            >
              <RNText>{item.label}</RNText>
            </Pressable>
          ))
        : null}
    </View>
  );
}
Picker.Item = () => null;

export function BottomSheet({ isPresented, children, testID }: AnyProps) {
  return isPresented ? <View testID={testID as string}>{children}</View> : null;
}
