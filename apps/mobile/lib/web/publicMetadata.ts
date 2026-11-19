import type { Metadata } from "expo-router/server";

const ORIGIN = "https://animeishi.uomi.dev";

export function publicMetadata(
  path: string,
  title: string,
  description: string,
): Metadata {
  const url = `${ORIGIN}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      type: "website",
      url,
      siteName: "アニ名刺",
      locale: "ja_JP",
      images: `${ORIGIN}/ogp.png`,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: `${ORIGIN}/ogp.png`,
    },
  };
}
