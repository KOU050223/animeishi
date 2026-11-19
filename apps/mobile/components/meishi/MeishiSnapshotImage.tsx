import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";

/**
 * 公開名刺スナップショット（issue #593: 名刺の保存時に既定の名刺を撮って
 * サーバーへ置く幅 1280 の PNG）の表示。読み込み中・失敗・URL なしのときは
 * fallback（classic テンプレの MeishiCard）を出す（issue #591 第 2 段階）。
 */
export function MeishiSnapshotImage({
  uri,
  fallback,
  testID,
}: {
  uri: string | null | undefined;
  fallback: ReactNode;
  testID?: string;
}) {
  // 読了/失敗フラグは URL と組で持ち、URL が変わったら下ろす
  // （?v= クエリで再撮影後のスナップショットは別 URL になる）。
  const [state, setState] = useState({
    uri,
    loaded: false,
    failed: false,
    aspectRatio: 0,
  });
  if (state.uri !== uri) {
    setState({ uri, loaded: false, failed: false, aspectRatio: 0 });
  }
  const current =
    state.uri === uri
      ? state
      : { uri, loaded: false, failed: false, aspectRatio: 0 };

  if (!uri || current.failed) return <>{fallback}</>;

  return (
    <View testID={testID}>
      {current.loaded ? null : fallback}
      <Image
        source={{ uri }}
        style={
          current.loaded && current.aspectRatio > 0
            ? [styles.snapshot, { aspectRatio: current.aspectRatio }]
            : styles.loading
        }
        // タップ領域の内側にある画像が web のネイティブドラッグで
        // pointercancel を起こしジェスチャを殺すのを防ぐ（issue #327）。
        draggable={false}
        cachePolicy="memory-disk"
        transition={150}
        onLoad={(event) =>
          setState((s) =>
            s.uri === uri
              ? {
                  ...s,
                  loaded: true,
                  aspectRatio: event.source.width / event.source.height,
                }
              : s,
          )
        }
        onError={() =>
          setState((s) => (s.uri === uri ? { ...s, failed: true } : s))
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // 読み込み中は fallback（MeishiCard）を表示し、画像はレイアウトに
  // 出さず裏で読み込む。
  loading: { position: "absolute", width: 1, height: 1, opacity: 0 },
  // MeishiCard の枠（角丸・影）と揃える。
  snapshot: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.15)",
  },
});
