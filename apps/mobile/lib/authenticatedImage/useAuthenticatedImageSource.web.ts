import { useEffect, useState } from "react";
import { useAuth } from "@clerk/expo";
import type { ImageSource } from "expo-image";
import type { UseAuthenticatedImageSource } from "./types";

/**
 * Web: <img> は Authorization ヘッダを付けられないため、fetch で
 * 認証付き取得した Blob を object URL にして返す（本人専用の名刺
 * コピー等の表示用。issue #662）。object URL はクリーンアップで
 * 破棄する。
 */
export const useAuthenticatedImageSource: UseAuthenticatedImageSource = (
  uri,
) => {
  const { getToken } = useAuth();
  const [source, setSource] = useState<ImageSource | null>(null);
  const [prevUri, setPrevUri] = useState(uri);
  if (prevUri !== uri) {
    setPrevUri(uri);
    setSource(null);
  }

  useEffect(() => {
    if (!uri) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    void (async () => {
      const token = await getToken();
      if (!token || cancelled) return;
      const res = await fetch(uri, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok || cancelled) return;
      objectUrl = URL.createObjectURL(await res.blob());
      if (!cancelled) setSource({ uri: objectUrl });
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [uri, getToken]);

  return source;
};
