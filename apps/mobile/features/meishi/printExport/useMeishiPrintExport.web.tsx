import { useRef, useState } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { useTranslation } from "react-i18next";
import { MeishiPrintSnapshot } from "@/components/meishi/MeishiPrintSnapshot";
import { alert } from "@/lib/dialog";
import {
  captureTierListImageFile,
  downloadImageFile,
} from "@/lib/tierList/share/image";
import { resolveMeishiDocument } from "../templates";
import { runMeishiPrintExport } from "./capture";
import type { UseMeishiPrintExport } from "./types";

/**
 * 名刺の印刷用書き出し（issue #665）の Web 版。画像共有と違って
 * ダウンロードには Web Share API のユーザー操作期限が無いため、
 * スナップショットは共有のたびにマウントして待つ方式でよい
 * （1146×720 の大きな描画を常時ぶら下げる必要がない）。
 * 表・裏それぞれを PNG にして 2 ファイル連続でダウンロードする。
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

  const doc = resolveMeishiDocument(document);
  const profileUrl = context.profile.profileUrl;

  const exportPrintImages = async () => {
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
        // スナップショットは出力サイズ（1146×720）と同じ実寸で
        // 描いているため pixelRatio は 1。2 面の撮影は逐次にする
        // （html-to-image は面ごとに画像プロキシ差し替えと canvas 変換を
        // 行うため、並列で走らせると描画が競合しうる）。
        const frontFile = await captureTierListImageFile(front, {
          title: "meishi-front",
          backgroundColor: "#ffffff",
          pixelRatio: 1,
        });
        const backFile = await captureTierListImageFile(back, {
          title: "meishi-back",
          backgroundColor: "#ffffff",
          pixelRatio: 1,
        });
        downloadImageFile(frontFile);
        downloadImageFile(backFile);
      },
      failureTitle: t("印刷用データの書き出しに失敗しました"),
      failureMessage: t("時間をおいて再度お試しください。"),
    });
    setSnapshotRequested(false);
    setIsExporting(false);
    snapshotReadyRef.current = null;
  };

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
