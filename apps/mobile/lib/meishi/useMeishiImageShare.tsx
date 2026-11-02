import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { useTranslation } from "react-i18next";
import { MeishiShareSnapshot } from "@/components/meishi/MeishiShareSnapshot";
import { alert } from "@/lib/dialog";
import { trackEvent } from "@/lib/events";
import { useThemeColors } from "@/lib/theme";
import { shareTierListImage } from "@/lib/tierList/share";
import { resolveMeishiDocument } from "./templates";
import type { MeishiDocument, MeishiRenderContext } from "./types";

/**
 * 画像キャプチャ前にスナップショットの画像読み込みを待つ上限。
 * これを超えても未読み込みなら欠けたまま撮る（共有自体を失敗させない）。
 */
const SNAPSHOT_WAIT_MAX_MS = 5000;

export type UseMeishiImageShare = (input: {
  /** 名刺ドキュメント。未作成（null）なら classic テンプレで撮る。 */
  document: MeishiDocument | null | undefined;
  context: MeishiRenderContext;
}) => {
  /** 名刺を画像化して OS の共有シート（web は共有 / ダウンロード）へ渡す。 */
  shareImage: () => Promise<void>;
  isSharing: boolean;
  /** 画面外スナップショットの描画要素。画面の JSX に必ず描画すること。 */
  snapshotElement: ReactNode;
};

/**
 * 名刺の画像共有フロー（issue #425）。キャプチャ対象のスナップショットを
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
    try {
      trackEvent("meishi_share");
      const snapshotReady = new Promise<void>((resolve) => {
        snapshotReadyRef.current = resolve;
      });
      setSnapshotRequested(true);
      // スナップショットの描画と画像の読み込み（onReady）を待ってから撮る。
      // タイムアウトを超えたら読み込み途中のまま撮る（共有自体は失敗させない）。
      await Promise.race([
        snapshotReady,
        new Promise((resolve) => setTimeout(resolve, SNAPSHOT_WAIT_MAX_MS)),
      ]);
      // レイアウト確定のため 1 フレーム待つ
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (!snapshotRef.current) {
        throw new Error("スナップショットの描画に失敗しました");
      }
      await shareTierListImage(snapshotRef, {
        dialogTitle: t("名刺"),
        backgroundColor: colors.background,
      });
    } catch {
      alert(
        t("画像の共有に失敗しました"),
        t("時間をおいて再度お試しください。"),
        {
          okLabel: "OK",
        },
      );
    } finally {
      setSnapshotRequested(false);
      setIsSharing(false);
      snapshotReadyRef.current = null;
    }
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
