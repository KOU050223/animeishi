import { useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { Image } from "expo-image";

export type MeishiSnapshotImageProps = {
  /** 公開スナップショットの配信 URL。?v= に版が入り、再生成で URL ごと変わる。 */
  uri: string;
  /** 読み込み中・失敗時に代わりに出す要素（端末内レンダリングの名刺）。 */
  fallback: ReactNode;
  accessibilityLabel?: string;
};

/**
 * 公開名刺スナップショット（issue #593）をそのまま表示する。
 * 相手が受け取るのと同じ画像を出すため、端末内レンダリングではなく
 * 配信済みの画像を使う。読み込みが終わるまでは fallback を出し、
 * 失敗したときも fallback に留める。
 * アスペクト比は画像の実寸法から取る（スナップショットには余白が
 * 含まれるため、名刺の canvas.aspectRatio とは一致しない）。
 * URL が変わったときに状態を残さないよう、呼び出し側は key={uri} で
 * リマウントすること。
 */
export function MeishiSnapshotImage({
  uri,
  fallback,
  accessibilityLabel,
}: MeishiSnapshotImageProps) {
  const [loadedAspectRatio, setLoadedAspectRatio] = useState<number | null>(
    null,
  );
  const [failed, setFailed] = useState(false);

  if (failed) return <>{fallback}</>;

  return (
    <>
      {/* 実寸法が取れるまではフォールバックを表に出し、画像は見えない
          プローブとして裏で読み込ませる */}
      {loadedAspectRatio === null ? fallback : null}
      <Image
        source={{ uri }}
        style={
          loadedAspectRatio === null
            ? styles.probe
            : [styles.image, { aspectRatio: loadedAspectRatio }]
        }
        // プローブ中は画面に出ていないため読み上げ対象から外す。
        // 表示された時点で accessibilityLabel が有効になる。
        accessible={loadedAspectRatio !== null}
        contentFit="contain"
        onLoad={(event) =>
          setLoadedAspectRatio(event.source.width / event.source.height)
        }
        onError={() => setFailed(true)}
        accessibilityLabel={accessibilityLabel}
        testID="meishi-snapshot-image"
      />
    </>
  );
}

const styles = StyleSheet.create({
  image: {
    width: "100%",
    borderRadius: 16,
    boxShadow: "0px 4px 12px rgba(0, 0, 0, 0.15)",
  },
  probe: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
