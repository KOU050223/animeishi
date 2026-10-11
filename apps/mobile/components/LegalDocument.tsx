import { Link } from "expo-router";
import { ScrollView, Text, View } from "react-native";

/** 法務ページ（プライバシーポリシー / 利用規約）の 1 セクション。 */
export type LegalSection = {
  heading: string;
  /** 段落。複数指定すると空行区切りで表示する。 */
  paragraphs?: string[];
  /** 箇条書き項目。 */
  bullets?: string[];
};

type Props = {
  title: string;
  /** 「施行日: 2026年10月11日」のような改定日時の表示行。 */
  effectiveDate: string;
  sections: LegalSection[];
};

/**
 * /privacy /terms 共通の法務文書レイアウト。
 * 未ログインでも閲覧できる公開ページ（app/_layout.tsx の公開ルート参照）。
 * 文言は日本語固定（i18n 対象外。profile.tsx 等と同じく直書き）。
 */
export function LegalDocument({ title, effectiveDate, sections }: Props) {
  return (
    <ScrollView className="flex-1 bg-white">
      <View className="w-full max-w-2xl self-center px-6 pb-16 pt-12">
        <Text className="text-2xl font-bold text-gray-900">{title}</Text>
        <Text className="mt-2 text-xs text-gray-400">{effectiveDate}</Text>

        {sections.map((section) => (
          <View key={section.heading} className="mt-8">
            <Text className="text-base font-semibold text-gray-900">
              {section.heading}
            </Text>
            {section.paragraphs?.map((paragraph, i) => (
              <Text key={i} className="mt-2 text-sm leading-6 text-gray-700">
                {paragraph}
              </Text>
            ))}
            {section.bullets ? (
              <View className="mt-2 gap-1">
                {section.bullets.map((bullet, i) => (
                  <Text key={i} className="text-sm leading-6 text-gray-700">
                    ・{bullet}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ))}

        <View className="mt-12 flex-row justify-center gap-6 border-t border-gray-100 pt-6">
          <Link href="/privacy" testID="legal-privacy-link">
            <Text className="text-sm text-indigo-600">
              プライバシーポリシー
            </Text>
          </Link>
          <Link href="/terms" testID="legal-terms-link">
            <Text className="text-sm text-indigo-600">利用規約</Text>
          </Link>
        </View>
      </View>
    </ScrollView>
  );
}
