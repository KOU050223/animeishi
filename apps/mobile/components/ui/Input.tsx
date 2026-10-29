import { forwardRef } from "react";
import { TextInput } from "react-native";
import type { TextInputInstance, TextInputProps } from "react-native";
import { useThemeColors } from "@/lib/theme";

export type InputProps = TextInputProps;

/**
 * 共通テキスト入力。RN の TextInput と同じ props を受け取り、
 * `placeholderTextColor` の既定値だけをカラートークン (#161 / #171) に固定する。
 * 個別画面でプレースホルダー色を指定しないこと。
 *
 * スキーム判定は RN の useColorScheme を使うため、ダークモード (#171) で
 * `dark:` バリアントが有効になるのと同じ条件で dark トークンへ切り替わる。
 */
export const Input = forwardRef<TextInputInstance, InputProps>(function Input(
  { placeholderTextColor, ...props },
  ref,
) {
  const colors = useThemeColors();

  return (
    <TextInput
      ref={ref}
      placeholderTextColor={placeholderTextColor ?? colors.placeholder}
      {...props}
    />
  );
});
