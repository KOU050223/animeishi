import { forwardRef } from "react";
import { TextInput } from "react-native";
import type { TextInputProps } from "react-native";
import { useColorScheme } from "nativewind";
import { colors } from "@/lib/theme";

export type InputProps = TextInputProps;

/**
 * 共通テキスト入力。RN の TextInput と同じ props を受け取り、
 * `placeholderTextColor` の既定値だけをカラートークン (#161 / #171) に固定する。
 * 個別画面でプレースホルダー色を指定しないこと。
 *
 * スキーム判定は nativewind の useColorScheme を使うため、ダークモード (#171) で
 * `dark:` バリアントが有効になるのと同じ条件で dark トークンへ切り替わる。
 */
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { placeholderTextColor, ...props },
  ref,
) {
  const { colorScheme } = useColorScheme();
  const scheme = colorScheme === "dark" ? "dark" : "light";

  return (
    <TextInput
      ref={ref}
      placeholderTextColor={placeholderTextColor ?? colors[scheme].placeholder}
      {...props}
    />
  );
});
