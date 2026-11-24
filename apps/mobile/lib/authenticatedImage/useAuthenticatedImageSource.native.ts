import { useEffect, useState } from "react";
import { clerkSessionToken } from "@/lib/api";
import type { ImageSource } from "expo-image";
import type { UseAuthenticatedImageSource } from "./types";

/**
 * iOS/Android: expo-image の source.headers に Authorization を載せて
 * 認証付きで取得する（本人専用の名刺コピー等、URL だけでは 401/404 に
 * なる画像の表示用。issue #662）。
 * トークン取得中・未取得・uri なしの間は null を返し、呼び出し側は
 * プレースホルダを出す。
 */
export const useAuthenticatedImageSource: UseAuthenticatedImageSource = (
  uri,
) => {
  const [source, setSource] = useState<ImageSource | null>(null);
  const [prevUri, setPrevUri] = useState(uri);
  if (prevUri !== uri) {
    setPrevUri(uri);
    setSource(null);
  }

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    void clerkSessionToken().then((token) => {
      if (cancelled) return;
      setSource(
        token ? { uri, headers: { Authorization: `Bearer ${token}` } } : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [uri]);

  return source;
};
