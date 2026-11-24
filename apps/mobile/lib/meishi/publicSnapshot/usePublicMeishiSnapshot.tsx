import { useCallback, useMemo, useRef } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { MeishiShareSnapshot } from "@/components/meishi/MeishiShareSnapshot";
import { apiFetch } from "@/lib/api";
import { apiUrl } from "@/lib/apiUrl";
import { resolveMeishiDocument } from "../templates";
import type { MeishiDocument, MeishiRenderContext } from "../types";
import { capturePublicSnapshot } from "./capture";
import { enqueueSnapshotOperation } from "./queue";

const SNAPSHOT_URL = `${apiUrl.replace(/\/$/, "")}/me/meishi-snapshot`;

export function usePublicMeishiSnapshot(
  document: MeishiDocument | null | undefined,
  context: MeishiRenderContext,
) {
  const ref = useRef<ViewInstance>(null);
  const readyRef = useRef<(() => void) | null>(null);
  const readyKeyRef = useRef<string | null>(null);
  const resolved = useMemo(() => resolveMeishiDocument(document), [document]);
  const snapshotKey = JSON.stringify({ resolved, context });
  const publish = useCallback(
    () =>
      enqueueSnapshotOperation(async () => {
        if (readyKeyRef.current !== snapshotKey)
          await Promise.race([
            new Promise<void>((resolve) => {
              readyRef.current = resolve;
            }),
            new Promise<void>((resolve) => setTimeout(resolve, 5000)),
          ]);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        const blob = await capturePublicSnapshot(ref);
        // アップロードの失敗は呼び出し側で warn ログに留めるだけなので、
        // ApiRequestError ではなく plain Error のままにする。
        await apiFetch({
          onHttpError: async (res) =>
            new Error(`Snapshot upload failed: ${res.status}`),
        })(SNAPSHOT_URL, {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: blob,
        });
      }),
    [snapshotKey],
  );
  const clear = useCallback(
    () =>
      enqueueSnapshotOperation(async () => {
        await apiFetch({
          onHttpError: async (res) =>
            new Error(`Snapshot delete failed: ${res.status}`),
        })(SNAPSHOT_URL, { method: "DELETE" });
      }),
    [],
  );
  const snapshotElement = (
    <View style={styles.offscreen}>
      <MeishiShareSnapshot
        key={snapshotKey}
        ref={ref}
        document={resolved}
        context={context}
        includeFooter={false}
        onReady={() => {
          readyKeyRef.current = snapshotKey;
          readyRef.current?.();
        }}
      />
    </View>
  );
  return { publish, clear, snapshotElement };
}

const styles = StyleSheet.create({
  offscreen: { position: "absolute", left: -2000, top: 0 },
});
