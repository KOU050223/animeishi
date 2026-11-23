import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { PressableProps } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
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

// 無効状態は透過ではなくグレー面＋薄い文字に差し替える。
// variant の塗り色を薄めるだけでは有効なボタンと見分けが付かないため。
const DISABLED_CLASSES = {
  button: "bg-slate-200 dark:bg-slate-700",
  label: "text-slate-500 dark:text-slate-400",
} as const;

/**
 * 共通ボタン。variant で primary（主 CTA）/ secondary（枠線）/
 * destructive（削除などの危険操作、赤系の控えめ面）を切り替える。
 * 押下中・ローディング中は透過で、無効状態はグレー面でフィードバックする。
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
  // ローディング中は variant の面のままスピナーを出すため、グレー化はしない。
  const showDisabled = !!disabled && !loading;
  const classes = showDisabled ? DISABLED_CLASSES : VARIANT_CLASSES[variant];
  const spinnerColor =
    variant === "primary"
      ? colors.onPrimary
      : variant === "destructive"
        ? colors.danger
        : colors.text;
  const labelColor = showDisabled
    ? colors.textMuted
    : variant === "primary"
      ? colors.onPrimary
      : variant === "destructive"
        ? colors.danger
        : colors.text;

  return (
    <Pressable
      className={`items-center justify-center rounded-lg px-4 py-4 ${classes.button}`}
      style={({ pressed }) => ({
        opacity: pressed || loading ? 0.6 : 1,
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
          <Text className={`font-semibold text-base ${classes.label}`}>
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
