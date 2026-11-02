import { forwardRef, useCallback, useEffect, useMemo, useRef } from "react";
import { StyleSheet, Text, View, type ViewInstance } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { MeishiRenderer } from "./MeishiRenderer";
import { countRenderableImages } from "./elements/ElementRenderer";
import { useThemeColors, type ThemeColors } from "@/lib/theme";
import type { MeishiDocument, MeishiRenderContext } from "@/lib/meishi/types";

/** 共有画像の横幅。 */
const SNAPSHOT_WIDTH = 640;

export type MeishiShareSnapshotProps = {
  document: MeishiDocument;
  context: MeishiRenderContext;
  /**
   * カード内の全画像の読み込みが完了（成功・失敗問わず onLoadEnd 到達）
   * したときに一度だけ呼ばれる。view-shot のキャプチャ開始タイミングに使う。
   * 画像が 1 枚も無い場合はマウント直後に呼ばれる。
   */
  onReady?: () => void;
};

/**
 * 画像エクスポート用の表示専用名刺。画面外にレンダリングして
 * view-shot / html-to-image で PNG 化する（TierBoardSnapshot と同じ構造）。
 * カード本体の下に名刺 URL の QR と URL 文字列を添え、受け取った人が
 * プロフィールへ辿れるようにする（issue #425）。
 * 配色は撮影時点のカラースキームに追従する。
 */
export const MeishiShareSnapshot = forwardRef<
  ViewInstance,
  MeishiShareSnapshotProps
>(function MeishiShareSnapshot({ document, context, onReady }, ref) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const imageCount = useMemo(
    () => countRenderableImages(document, context),
    [document, context],
  );
  const settledRef = useRef(0);
  const firedRef = useRef(false);

  const markImageSettled = useCallback(() => {
    settledRef.current += 1;
    if (!firedRef.current && settledRef.current >= imageCount) {
      firedRef.current = true;
      onReady?.();
    }
  }, [imageCount, onReady]);

  // 画像ゼロなら待つものが無いのでマウント直後に ready を通知する。
  useEffect(() => {
    if (imageCount === 0 && !firedRef.current) {
      firedRef.current = true;
      onReady?.();
    }
  }, [imageCount, onReady]);

  const profileUrl = context.profile.profileUrl;

  return (
    // Android で view-shot が失敗しないよう collapsable={false} は必須
    <View ref={ref} collapsable={false} style={styles.root}>
      <MeishiRenderer
        document={document}
        context={context}
        borderRadius={12}
        onImageLoadEnd={markImageSettled}
      />
      {profileUrl ? (
        <View style={styles.footer}>
          {/* QR は読み取り精度のため常に白い面に描画する */}
          <View style={styles.qrBox}>
            <QRCode value={profileUrl} size={72} />
          </View>
          <Text style={styles.urlText} numberOfLines={1}>
            {profileUrl}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      width: SNAPSHOT_WIDTH,
      backgroundColor: colors.background,
      padding: 16,
      gap: 12,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    qrBox: {
      backgroundColor: "#ffffff",
      padding: 6,
      borderRadius: 8,
    },
    urlText: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 14,
    },
  });
}
