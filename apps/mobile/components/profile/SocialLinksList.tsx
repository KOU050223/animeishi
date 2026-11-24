import { Linking, Pressable, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTranslation } from "react-i18next";
import type { SocialLink, SocialLinkKind } from "@/lib/socialLinks";
import { socialLinkLabel } from "@/lib/socialLinks";

const icons: Record<SocialLinkKind, keyof typeof Ionicons.glyphMap> = {
  x: "logo-twitter",
  pixiv: "color-palette-outline",
  fanbox: "gift-outline",
  dlsite: "storefront-outline",
  dmm: "bag-outline",
  youtube: "logo-youtube",
  other: "link-outline",
};

export function SocialLinksList({ links }: { links: SocialLink[] }) {
  const { t } = useTranslation();
  if (!links.length) return null;
  return (
    <View className="w-full mt-5" testID="social-links-list">
      <Text className="mb-2 text-base font-semibold text-foreground">
        {t("SNS リンク")}
      </Text>
      <View className="gap-2">
        {links.map((link) => (
          <Pressable
            key={`${link.kind}-${link.value}`}
            className="flex-row items-center rounded-xl bg-slate-50 dark:bg-slate-800 px-4 py-3"
            onPress={() => {
              void Linking.openURL(link.url);
            }}
            accessibilityRole="link"
            accessibilityLabel={`${socialLinkLabel(link.kind)} ${link.value}`}
          >
            <Ionicons name={icons[link.kind]} size={20} color="#6366f1" />
            <Text className="ml-3 flex-1 text-foreground" numberOfLines={1}>
              {socialLinkLabel(link.kind)} · {link.value}
            </Text>
            <Ionicons name="open-outline" size={17} color="#64748b" />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
