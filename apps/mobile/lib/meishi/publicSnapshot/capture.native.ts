import { captureRef } from "react-native-view-shot";
import type { RefObject } from "react";
import type { ViewInstance } from "react-native";

export async function capturePublicSnapshot(
  ref: RefObject<ViewInstance | null>,
): Promise<Blob> {
  const uri = await captureRef(ref, { format: "png", quality: 1, width: 1280 });
  const response = await fetch(uri);
  if (!response.ok && response.status !== 0) {
    throw new Error(`Snapshot read failed: ${response.status}`);
  }
  return response.blob();
}
