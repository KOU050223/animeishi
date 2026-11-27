import { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { StyleSheet, Text, View, type ViewInstance } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { MeishiRenderer } from "./MeishiRenderer";
import { countRenderableImages } from "@/features/meishi/renderableImages";
import {
  getCoverRect,
  getPrintLayout,
  type PrintLayout,
} from "@/features/meishi/printExport/printLayout";
import type {
  MeishiDocument,
  MeishiRenderContext,
} from "@/features/meishi/types";

export type MeishiPrintSnapshotProps = {
  document: MeishiDocument;
  context: MeishiRenderContext;
  /** 表面（名刺本体）のキャプチャ対象。 */
  frontRef: RefObject<ViewInstance | null>;
  /** 裏面（最新の名刺が開く QR）のキャプチャ対象。 */
  backRef: RefObject<ViewInstance | null>;
  /**
   * カード内の全画像の読み込みが完了（成功・失敗問わず onLoadEnd 到達）
   * したときに一度だけ呼ばれる。キャプチャ開始タイミングに使う。
   * 画像が 1 枚も無い場合はマウント直後に呼ばれる。
   */
  onReady?: () => void;
};

/**
 * 印刷用データ（issue #665）として書き出す表・裏の 2 面。画面外に
 * レンダリングして view-shot / html-to-image で PNG 化する。
 * 画面共有用の MeishiShareSnapshot（幅 640）とは別系統で、
 * 仕上がり 91×55mm・塗り足し 3mm・300dpi のサイズで描く。
 *
 * 表面は名刺デザインを塗り足し端までカバーで広げ、角は落とさない
 * （紙の裁断面は四角いため）。裏面は白地に最新の名刺が開く
 * プロフィール URL の QR だけを置く。紙の情報は古くなるが、
 * QR からは常に最新の名刺が開く。
 */
export function MeishiPrintSnapshot({
  document,
  context,
  frontRef,
  backRef,
  onReady,
}: MeishiPrintSnapshotProps) {
  const layout: PrintLayout = getPrintLayout();
  const imageCount = countRenderableImages(document, context);
  const settledRef = useRef(0);
  const firedRef = useRef(false);

  const markImageSettled = () => {
    settledRef.current += 1;
    if (!firedRef.current && settledRef.current >= imageCount) {
      firedRef.current = true;
      onReady?.();
    }
  };

  // 画像ゼロなら待つものが無いのでマウント直後に ready を通知する。
  useEffect(() => {
    if (imageCount === 0 && !firedRef.current) {
      firedRef.current = true;
      onReady?.();
    }
  }, [imageCount, onReady]);

  const cover = getCoverRect(
    { width: layout.widthPx, height: layout.heightPx },
    document.canvas.aspectRatio,
  );
  const profileUrl = context.profile.profileUrl;

  return (
    <View>
      {/* 表面: 名刺デザインを塗り足し込みの領域いっぱいに広げる。 */}
      <View
        ref={frontRef}
        collapsable={false}
        style={[
          styles.face,
          { width: layout.widthPx, height: layout.heightPx },
        ]}
      >
        <View
          style={{
            position: "absolute",
            left: cover.x,
            top: cover.y,
            width: cover.width,
            height: cover.height,
          }}
        >
          <MeishiRenderer
            document={document}
            context={context}
            borderRadius={0}
            onImageLoadEnd={markImageSettled}
          />
        </View>
      </View>
      {/* 裏面: 最新の名刺が開く QR。紙自体の情報は古くなるため、
          読み取り先は常に最新が表示される公開プロフィールにする。 */}
      <View
        ref={backRef}
        collapsable={false}
        style={[
          styles.face,
          styles.back,
          { width: layout.widthPx, height: layout.heightPx },
        ]}
      >
        {profileUrl ? (
          <>
            <QRCode value={profileUrl} size={layout.backQrPx} />
            <Text style={styles.urlText}>{profileUrl}</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  face: {
    backgroundColor: "#ffffff",
    overflow: "hidden",
  },
  back: {
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
  },
  urlText: {
    color: "#4b5563",
    fontSize: 24,
  },
});
