import { useCallback, useMemo, useRef } from "react";
import { StyleSheet, View, type ViewInstance } from "react-native";
import { useAuth } from "@clerk/expo";
import { MeishiShareSnapshot } from "@/components/meishi/MeishiShareSnapshot";
import { apiUrl } from "@/lib/apiUrl";
import { resolveMeishiDocument } from "../templates";
import type { MeishiDocument, MeishiRenderContext } from "../types";
import { capturePublicSnapshot } from "./capture";
import { enqueueSnapshotOperation } from "./queue";

export function usePublicMeishiSnapshot(
  document: MeishiDocument | null | undefined,
  context: MeishiRenderContext,
) {
  const { getToken } = useAuth();
  const ref = useRef<ViewInstance>(null);
  const readyRef = useRef<(() => void) | null>(null);
  const readyKeyRef = useRef<string | null>(null);
  const resolved = useMemo(() => resolveMeishiDocument(document), [document]);
  const snapshotKey = JSON.stringify({ resolved, context });
  const publish = useCallback(
    () =>
      enqueueSnapshotOperation(async () => {
        const token = await getToken();
        if (!token) throw new Error("Authentication token unavailable");
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
        const response = await fetch(
          `${apiUrl.replace(/\/$/, "")}/me/meishi-snapshot`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "image/png",
            },
            body: blob,
          },
        );
        if (!response.ok)
          throw new Error(`Snapshot upload failed: ${response.status}`);
      }),
    [getToken, snapshotKey],
  );
  const clear = useCallback(
    () =>
      enqueueSnapshotOperation(async () => {
        const token = await getToken();
        if (!token) throw new Error("Authentication token unavailable");
        const response = await fetch(
          `${apiUrl.replace(/\/$/, "")}/me/meishi-snapshot`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!response.ok)
          throw new Error(`Snapshot delete failed: ${response.status}`);
      }),
    [getToken],
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
