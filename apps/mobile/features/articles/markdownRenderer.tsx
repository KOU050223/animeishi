import type { ReactNode } from "react";
import { Linking, Text, type TextStyle } from "react-native";
import { Renderer } from "react-native-marked";

// react-native-marked の既定の link は accessibilityLabel={title ?? "Link"} を
// 付ける。Web では aria-label になるため、[公式サイト](URL) のような
// リンクテキストがアクセシブル名としてすべて「Link」に潰される（issue #607）。
// ラベルを付けなければリンクテキスト自体がアクセシブル名になる。
export class AccessibleLinkRenderer extends Renderer {
  link(
    children: string | ReactNode[],
    href: string,
    styles?: TextStyle,
  ): ReactNode {
    return (
      <Text
        selectable
        accessibilityRole="link"
        key={this.getKey()}
        onPress={() => {
          Linking.openURL(href).catch((e: unknown) => {
            console.warn("URL can't be opened", e);
          });
        }}
        style={styles}
      >
        {children}
      </Text>
    );
  }
}
