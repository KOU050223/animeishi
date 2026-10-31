import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { PressableProps } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useThemeColors } from "@/lib/theme";

export type ButtonVariant = "primary" | "secondary" | "destructive";

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  /** ボタンに表示するラベル。文言は基盤側に既定値を持たせず呼び出し側が渡す。 */
  label: string;
  variant?: ButtonVariant;
  /** ラベルの左に置くアイコン。 */
  icon?: ComponentProps<typeof Ionicons>["name"];
  /** true の間はラベルの代わりにインジケータを出し、タップも無効化する。 */
  loading?: boolean;
};

const VARIANT_CLASSES: Record<
  ButtonVariant,
  { button: string; label: string }
> = {
  primary: {
    button: "bg-indigo-600",
    label: "text-white",
  },
  secondary: {
    button:
      "border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800",
    label: "text-slate-900 dark:text-slate-100",
  },
  destructive: {
    button:
      "border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950",
    label: "text-red-600 dark:text-red-400",
  },
};

/**
 * 共通ボタン。variant で primary（主 CTA）/ secondary（枠線）/
 * destructive（削除などの危険操作、赤系の控えめ面）を切り替える。
 * 押下中・無効・ローディング中は透過でフィードバックする。
 */
export function Button({
  label,
  variant = "primary",
  icon,
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  const colors = useThemeColors();
  const spinnerColor =
    variant === "primary"
      ? colors.onPrimary
      : variant === "destructive"
        ? colors.danger
        : colors.text;
  const labelColor =
    variant === "primary"
      ? colors.onPrimary
      : variant === "destructive"
        ? colors.danger
        : colors.text;

  return (
    <Pressable
      className={`items-center justify-center rounded-lg px-4 py-4 ${VARIANT_CLASSES[variant].button}`}
      style={({ pressed }) => ({
        opacity: pressed || disabled || loading ? 0.6 : 1,
      })}
      disabled={disabled || loading}
      accessibilityRole="button"
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={spinnerColor} />
      ) : (
        <View className="flex-row items-center gap-1.5">
          {icon ? <Ionicons name={icon} size={17} color={labelColor} /> : null}
          <Text
            className={`font-semibold text-base ${VARIANT_CLASSES[variant].label}`}
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
