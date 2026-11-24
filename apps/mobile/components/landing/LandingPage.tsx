import { Link } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useTranslation } from "react-i18next";
import { MalAttribution } from "@/components/profile/MalAttribution";

const sampleWorks = [
  "星屑のアトリエ",
  "雨あがりの航路",
  "月面喫茶の夜",
] as const;

// S/A/B ティアの見本。タプルのリテラル添字で取るため要素が undefined にならない。
const sampleTiers = [
  { tier: "S", work: sampleWorks[0] },
  { tier: "A", work: sampleWorks[1] },
  { tier: "B", work: sampleWorks[2] },
] as const;

export default function LandingPage() {
  const { t } = useTranslation();

  return (
    <ScrollView
      className="flex-1 bg-slate-50 dark:bg-slate-950"
      contentContainerClassName="items-center"
      testID="landing-page"
    >
      <View className="w-full max-w-6xl px-5 md:px-10">
        <View className="h-20 flex-row items-center justify-between">
          <Text className="text-xl font-extrabold text-indigo-700 dark:text-indigo-300">
            {t("アニ名刺")}
          </Text>
          <View className="flex-row items-center gap-5">
            <Link href="/(auth)/sign-in" testID="landing-sign-in-top">
              <Text className="font-semibold text-slate-700 dark:text-slate-200">
                {t("サインイン")}
              </Text>
            </Link>
            <Link
              href="/(auth)/sign-up"
              className="rounded-full bg-indigo-600 px-5 py-3"
              testID="landing-sign-up-top"
            >
              <Text className="font-bold text-white">{t("無料で始める")}</Text>
            </Link>
          </View>
        </View>

        <View className="flex-col items-center gap-10 py-12 md:flex-row md:py-20">
          <View className="flex-1 items-start">
            <View className="mb-5 rounded-full bg-indigo-100 px-4 py-2 dark:bg-indigo-950">
              <Text className="font-semibold text-indigo-700 dark:text-indigo-300">
                {t("好きなアニメが、出会いのきっかけに")}
              </Text>
            </View>
            <Text className="text-4xl font-black leading-tight text-slate-950 dark:text-white md:text-6xl">
              {t("好きの記録が、\nあなたの名刺になる。")}
            </Text>
            <Text className="mt-5 max-w-xl text-lg leading-8 text-slate-600 dark:text-slate-300">
              {t(
                "観た作品も、推しへの熱も。アニメ好きのあなたらしさを形にして、次の出会いにつなげよう。",
              )}
            </Text>
            <View className="mt-8 flex-row flex-wrap items-center gap-4">
              <Link
                href="/(auth)/sign-up"
                className="rounded-full bg-indigo-600 px-7 py-4"
                testID="landing-sign-up-hero"
              >
                <View className="flex-row items-center gap-2">
                  <Text className="text-base font-bold text-white">
                    {t("無料で名刺を作る")}
                  </Text>
                  <Text
                    className="text-base font-bold text-white"
                    accessibilityElementsHidden
                  >
                    →
                  </Text>
                </View>
              </Link>
              <Text className="text-sm text-slate-500 dark:text-slate-400">
                {t("登録して、あなたの好きから始めよう")}
              </Text>
            </View>
          </View>
          <View className="w-full max-w-md flex-1 rounded-3xl border border-indigo-100 bg-white p-5 shadow-xl shadow-indigo-200/50 dark:border-slate-700 dark:bg-slate-900 dark:shadow-black/30 md:p-7">
            <View className="flex-row items-center justify-between">
              <Text className="text-sm font-bold tracking-widest text-indigo-600 dark:text-indigo-300">
                ANIMEISHI / YOUR CARD
              </Text>
              <View className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </View>
            <View className="mt-7 flex-row items-center gap-4">
              <View className="h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-200 to-indigo-200 dark:from-fuchsia-900 dark:to-indigo-900">
                <Text className="text-3xl">✦</Text>
              </View>
              <View>
                <Text className="text-2xl font-extrabold text-slate-900 dark:text-white">
                  {t("星乃 みなと")}
                </Text>
                <Text className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {t("物語の余韻を語りたい人")}
                </Text>
              </View>
            </View>
            <View className="mt-6 rounded-2xl bg-indigo-50 p-4 dark:bg-slate-800">
              <Text className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
                {t("最近の好き")}
              </Text>
              {sampleWorks.map((work, index) => (
                <View key={work} className="mt-3 flex-row items-center gap-3">
                  <View
                    className={`h-10 w-10 items-center justify-center rounded-lg ${index === 0 ? "bg-rose-200 dark:bg-rose-900" : index === 1 ? "bg-sky-200 dark:bg-sky-900" : "bg-amber-200 dark:bg-amber-900"}`}
                  >
                    <Text className="font-bold text-slate-700 dark:text-slate-200">
                      {index + 1}
                    </Text>
                  </View>
                  <Text className="font-semibold text-slate-800 dark:text-slate-100">
                    {t(work)}
                  </Text>
                </View>
              ))}
            </View>
            <View className="mt-5 flex-row items-center justify-between rounded-2xl border border-slate-100 p-4 dark:border-slate-700">
              <View>
                <Text className="font-bold text-slate-800 dark:text-slate-100">
                  {t("名刺交換はこちら")}
                </Text>
                <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  animeishi.uomi.dev/m/minato
                </Text>
              </View>
              <View
                className="items-center justify-center rounded-lg border-2 border-slate-800 bg-white p-1 dark:border-white"
                testID="landing-sample-qr"
              >
                <QRCode value="https://animeishi.uomi.dev/m/minato" size={40} />
              </View>
            </View>
          </View>
        </View>

        <View className="items-center py-12 md:py-16">
          <Text className="text-sm font-bold tracking-widest text-indigo-600 dark:text-indigo-300">
            {t("好きなものから、会話が広がる")}
          </Text>
          <Text className="mt-3 text-center text-3xl font-extrabold text-slate-900 dark:text-white md:text-4xl">
            {t("アニ名刺でできる、3つのこと")}
          </Text>
          <View className="mt-10 w-full flex-col gap-5 md:flex-row">
            <SceneCard
              number="01"
              title={t("イベントで、QRを見せて名刺交換")}
              description={t(
                "プロフィールを探し合わなくても大丈夫。QRを読み取って、好きな作品の話からつながろう。",
              )}
            >
              <View className="flex-row items-center gap-3 rounded-xl bg-white p-4 dark:bg-slate-800">
                <View
                  className="rounded-xl bg-white p-1 dark:bg-slate-800"
                  testID="landing-exchange-qr"
                >
                  <QRCode
                    value="https://animeishi.uomi.dev/m/minato"
                    size={40}
                  />
                </View>
                <View className="flex-1">
                  <Text className="font-bold text-slate-900 dark:text-white">
                    {t("アニ名刺を交換しました")}
                  </Text>
                  <Text className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t("共通の好きが 4 作品")}
                  </Text>
                </View>
                <Text className="text-xl text-emerald-500">✓</Text>
              </View>
            </SceneCard>
            <SceneCard
              number="02"
              title={t("推しのTier表を、SNSでシェア")}
              description={t(
                "好きな作品を並べて、自分だけのランキングに。友だちの好みも気になってくる。",
              )}
            >
              <View className="gap-2">
                {sampleTiers.map(({ tier, work }, index) => (
                  <View
                    key={tier}
                    className="flex-row overflow-hidden rounded-lg bg-white dark:bg-slate-800"
                  >
                    <View
                      className={`w-10 items-center justify-center ${index === 0 ? "bg-rose-300" : index === 1 ? "bg-amber-300" : "bg-sky-300"}`}
                    >
                      <Text className="font-black text-slate-800">{tier}</Text>
                    </View>
                    <Text className="px-3 py-2 font-semibold text-slate-800 dark:text-slate-100">
                      {t(work)}
                    </Text>
                  </View>
                ))}
              </View>
            </SceneCard>
            <SceneCard
              number="03"
              title={t("今期を振り返って、好きの傾向を発見")}
              description={t(
                "視聴記録が積み重なると、今期の一気見や心に残った作品が見えてくる。AI分析で新しい自分にも出会おう。",
              )}
            >
              <View className="rounded-xl bg-white p-4 dark:bg-slate-800">
                <Text className="text-xs font-bold text-indigo-600 dark:text-indigo-300">
                  {t("今期の視聴記録")}
                </Text>
                <Text className="mt-2 text-2xl font-black text-slate-900 dark:text-white">
                  12{" "}
                  <Text className="text-sm font-semibold">
                    {t("作品を視聴")}
                  </Text>
                </Text>
                <View className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                  <View className="h-full w-3/4 rounded-full bg-indigo-500" />
                </View>
                <Text className="mt-3 text-xs leading-5 text-slate-600 dark:text-slate-300">
                  {t(
                    "AIのひとこと：心の距離が縮まる物語に惹かれる傾向がありそう。",
                  )}
                </Text>
              </View>
            </SceneCard>
          </View>
        </View>

        <View className="my-8 rounded-3xl bg-indigo-600 px-6 py-10 md:my-14 md:px-12 md:py-14">
          <Text className="text-center text-3xl font-extrabold text-white md:text-4xl">
            {t("あなたの「好き」を、名刺にしよう。")}
          </Text>
          <Text className="mt-3 text-center leading-7 text-indigo-100">
            {t("作り方はかんたん。好きな作品を選ぶところから始められます。")}
          </Text>
          <View className="mt-9 flex-col gap-5 md:flex-row">
            {[
              ["01", t("アカウントを作成")],
              ["02", t("好きな作品を登録")],
              ["03", t("名刺を作ってシェア")],
            ].map(([number, label]) => (
              <View
                key={number}
                className="flex-1 flex-row items-center gap-3 rounded-2xl bg-white/10 p-4"
              >
                <Text className="text-2xl font-black text-indigo-200">
                  {number}
                </Text>
                <Text className="font-bold text-white">{label}</Text>
              </View>
            ))}
          </View>
          <Link
            href="/(auth)/sign-up"
            className="mt-8 self-center rounded-full bg-white px-8 py-4"
            testID="landing-sign-up-bottom"
          >
            <View className="flex-row items-center gap-2">
              <Text className="font-extrabold text-indigo-700">
                {t("無料で始める")}
              </Text>
              <Text
                className="font-extrabold text-indigo-700"
                accessibilityElementsHidden
              >
                →
              </Text>
            </View>
          </Link>
          <Text className="mt-4 text-center text-sm text-indigo-100">
            {t("すでにアカウントをお持ちの方は ")}
            <Link
              href="/(auth)/sign-in"
              className="font-bold text-white underline"
            >
              {t("サインイン")}
            </Link>
          </Text>
        </View>

        <View className="w-full flex-row flex-wrap items-center justify-center gap-x-6 gap-y-2 border-t border-slate-200 py-8 dark:border-slate-800">
          <Link href="/terms">
            <Text className="text-sm text-slate-500 dark:text-slate-400">
              {t("利用規約")}
            </Text>
          </Link>
          <Link href="/privacy">
            <Text className="text-sm text-slate-500 dark:text-slate-400">
              {t("プライバシーポリシー")}
            </Text>
          </Link>
          <MalAttribution />
          <Text className="w-full pt-3 text-center text-xs text-muted">
            © Animeishi
          </Text>
        </View>
      </View>
    </ScrollView>
  );
}

function SceneCard({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <View className="flex-1 rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 md:p-6">
      <Text className="text-xs font-black tracking-widest text-indigo-500">
        SCENE {number}
      </Text>
      <Text className="mt-3 text-xl font-extrabold leading-7 text-slate-900 dark:text-white">
        {title}
      </Text>
      <Text className="mt-3 min-h-20 leading-6 text-slate-600 dark:text-slate-300">
        {description}
      </Text>
      <View className="mt-5 rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
        {children}
      </View>
    </View>
  );
}
