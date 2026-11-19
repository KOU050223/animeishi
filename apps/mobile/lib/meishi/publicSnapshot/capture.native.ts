import { captureRef } from "react-native-view-shot";
import type { RefObject } from "react";
import type { ViewInstance } from "react-native";

export async function capturePublicSnapshot(
  ref: RefObject<ViewInstance | null>,
): Promise<Blob> {
  const uri = await captureRef(ref, { format: "png", quality: 1, width: 1280 });
  return (await fetch(uri)).blob();
}
