import { useCallback, useMemo, useRef, useState } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { useTranslation } from "react-i18next";
import { captureRef } from "react-native-view-shot";
import * as Sharing from "expo-sharing";
import { MeishiPrintSnapshot } from "@/components/meishi/MeishiPrintSnapshot";
import { alert } from "@/lib/dialog";
import { resolveMeishiDocument } from "../templates";
import { runMeishiPrintExport } from "./capture";
import { getPrintLayout } from "./printLayout";
import type { UseMeishiPrintExport } from "./types";

/**
 * 名刺の印刷用書き出し（issue #665）。書き出し実行の瞬間だけ
 * スナップショットを画面外に描画 → 画像の読み込みを待って撮影 →
 * 表・裏の PNG を順に OS の共有シートへ渡す（共有シートは
 * 1 ファイルずつしか渡せないため、表面→裏面の順で連続して開く）。
 */
export const useMeishiPrintExport: UseMeishiPrintExport = ({
  document,
  context,
}) => {
  const { t } = useTranslation();
  const [isExporting, setIsExporting] = useState(false);
  const [snapshotRequested, setSnapshotRequested] = useState(false);
  const frontRef = useRef<ViewInstance>(null);
  const backRef = useRef<ViewInstance>(null);
  const snapshotReadyRef = useRef<(() => void) | null>(null);

  const doc = useMemo(() => resolveMeishiDocument(document), [document]);
  const profileUrl = context.profile.profileUrl;

  const exportPrintImages = useCallback(async () => {
    if (!profileUrl) {
      alert(
        t("印刷用データを書き出せません"),
        t("プロフィールの読み込み後にもう一度お試しください。"),
        { okLabel: "OK" },
      );
      return;
    }
    setIsExporting(true);
    await runMeishiPrintExport({
      frontRef,
      backRef,
      mountSnapshot: () => setSnapshotRequested(true),
      snapshotReadyRef,
      deliver: async (front, back) => {
        const layout = getPrintLayout();
        const options = {
          format: "png" as const,
          quality: 1,
          width: layout.widthPx,
          height: layout.heightPx,
        };
        // 2 面の撮影は逐次にする。view-shot のキャプチャは画面外でも
        // レンダリング資源を使うため、並列で走らせると大きな面
        // （1146×720 × 2 面）の描画が競合しうる。
        const frontUri = await captureRef(front, {
          ...options,
          fileName: "meishi-front",
        });
        const backUri = await captureRef(back, {
          ...options,
          fileName: "meishi-back",
        });
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error("この端末では共有を利用できません");
        }
        await Sharing.shareAsync(frontUri, {
          mimeType: "image/png",
          dialogTitle: t("名刺（表面）"),
        });
        await Sharing.shareAsync(backUri, {
          mimeType: "image/png",
          dialogTitle: t("名刺（裏面）"),
        });
      },
      failureTitle: t("印刷用データの書き出しに失敗しました"),
      failureMessage: t("時間をおいて再度お試しください。"),
    });
    setSnapshotRequested(false);
    setIsExporting(false);
    snapshotReadyRef.current = null;
  }, [profileUrl, t]);

  const snapshotElement = snapshotRequested ? (
    <View style={styles.snapshotOffscreen}>
      <MeishiPrintSnapshot
        frontRef={frontRef}
        backRef={backRef}
        document={doc}
        context={context}
        onReady={() => snapshotReadyRef.current?.()}
      />
    </View>
  ) : null;

  return { exportPrintImages, isExporting, snapshotElement };
};

const styles = StyleSheet.create({
  snapshotOffscreen: { position: "absolute", left: -3000, top: 0 },
});
