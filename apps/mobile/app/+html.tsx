import {
  ScrollViewStyleReset,
  useServerDocumentContext,
} from "expo-router/html";
import type { PropsWithChildren } from "react";

export default function Html({ children }: PropsWithChildren) {
  const { headNodes, bodyNodes, htmlAttributes, bodyAttributes } =
    useServerDocumentContext();

  return (
    <html lang="ja" {...htmlAttributes}>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no"
        />
        <ScrollViewStyleReset />
        <link rel="manifest" href="/manifest.webmanifest" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="アニ名刺" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebSite",
              name: "アニ名刺",
              alternateName: "Animeishi",
              url: "https://animeishi.uomi.dev/",
            }),
          }}
        />
        {headNodes}
      </head>
      <body {...bodyAttributes}>
        <noscript>
          <p>アニ名刺は、アニメの視聴記録がそのまま名刺になるアプリです。</p>
          <ul>
            <li>
              <a href="/welcome">アニ名刺について</a>
            </li>
            <li>
              <a href="/privacy">プライバシーポリシー</a>
            </li>
            <li>
              <a href="/terms">利用規約</a>
            </li>
            <li>
              <a href="/support">サポート</a>
            </li>
          </ul>
        </noscript>
        {children}
        {bodyNodes}
      </body>
    </html>
  );
}
