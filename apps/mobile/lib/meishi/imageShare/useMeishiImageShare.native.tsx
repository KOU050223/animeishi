import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { useTranslation } from "react-i18next";
import { MeishiShareSnapshot } from "@/components/meishi/MeishiShareSnapshot";
import { useThemeColors } from "@/lib/theme";
import { resolveMeishiDocument } from "../templates";
import { runMeishiImageShare } from "./capture";
import type { UseMeishiImageShare } from "./types";

/**
 * 名刺の画像共有フロー（issue #425）。共有実行の瞬間だけスナップショットを
 * 画面外に描画 → 画像の読み込みを待って撮影 → 共有までをまとめて行う。
 * 画像化と共有の方式は Tier 表の基盤（lib/tierList/share の
 * shareTierListImage。native は view-shot + expo-sharing、web は
 * html-to-image + Web Share API / ダウンロード）をそのまま使う。
 */
export const useMeishiImageShare: UseMeishiImageShare = ({
  document,
  context,
}) => {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [isSharing, setIsSharing] = useState(false);
  // 共有実行の瞬間だけスナップショットを画面外に描画し、撮影後に取り除く。
  const [snapshotRequested, setSnapshotRequested] = useState(false);
  const snapshotRef = useRef<ViewInstance>(null);
  // MeishiShareSnapshot が全画像の読み込みを終えた合図を受け取る。
  // resolve はレンダー内の onReady から呼ぶので ref 経由で promise に逃がす。
  const snapshotReadyRef = useRef<(() => void) | null>(null);

  const doc = useMemo(() => resolveMeishiDocument(document), [document]);

  const shareImage = useCallback(async () => {
    setIsSharing(true);
    await runMeishiImageShare({
      snapshotRef,
      prepare: {
        mountSnapshot: () => setSnapshotRequested(true),
        snapshotReadyRef,
      },
      dialogTitle: t("名刺"),
      backgroundColor: colors.background,
      failureTitle: t("画像の共有に失敗しました"),
      failureMessage: t("時間をおいて再度お試しください。"),
    });
    setSnapshotRequested(false);
    setIsSharing(false);
    snapshotReadyRef.current = null;
  }, [colors, t]);

  const snapshotElement = snapshotRequested ? (
    <View style={styles.snapshotOffscreen}>
      <MeishiShareSnapshot
        ref={snapshotRef}
        document={doc}
        context={context}
        onReady={() => snapshotReadyRef.current?.()}
      />
    </View>
  ) : null;

  return { shareImage, isSharing, snapshotElement };
};

const styles = StyleSheet.create({
  snapshotOffscreen: { position: "absolute", left: -2000, top: 0 },
});
