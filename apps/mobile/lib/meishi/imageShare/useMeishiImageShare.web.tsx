import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { useTranslation } from "react-i18next";
import { MeishiShareSnapshot } from "@/components/meishi/MeishiShareSnapshot";
import { useThemeColors } from "@/lib/theme";
import { resolveMeishiDocument } from "../templates";
import { runMeishiImageShare } from "./capture";
import type { UseMeishiImageShare } from "./types";

/**
 * 名刺の画像共有フロー（issue #425）の Web 版。
 * Web Share API のユーザー操作期限（transient activation）があるため、
 * native と違ってスナップショットは共有ボタンを押す前から画面外に
 * 常時描画しておく。押下から撮影・共有までを即座に終えないと期限が切れ、
 * 共有シートではなくダウンロードへフォールバックしてしまう。
 * 画像化と共有の方式は Tier 表の基盤（lib/tierList/share）をそのまま使う。
 */
export const useMeishiImageShare: UseMeishiImageShare = ({
  document,
  context,
}) => {
  const { t } = useTranslation();
  const colors = useThemeColors();
  const [isSharing, setIsSharing] = useState(false);
  const snapshotRef = useRef<ViewInstance>(null);

  const doc = useMemo(() => resolveMeishiDocument(document), [document]);

  const shareImage = useCallback(async () => {
    setIsSharing(true);
    await runMeishiImageShare({
      snapshotRef,
      dialogTitle: t("名刺"),
      backgroundColor: colors.background,
      failureTitle: t("画像の共有に失敗しました"),
      failureMessage: t("時間をおいて再度お試しください。"),
    });
    setIsSharing(false);
  }, [colors, t]);

  // 押下前から画面外に描画しておき、押したら即撮影する（上記コメント参照）。
  const snapshotElement = (
    <View style={styles.snapshotOffscreen}>
      <MeishiShareSnapshot ref={snapshotRef} document={doc} context={context} />
    </View>
  );

  return { shareImage, isSharing, snapshotElement };
};

const styles = StyleSheet.create({
  snapshotOffscreen: { position: "absolute", left: -2000, top: 0 },
});
