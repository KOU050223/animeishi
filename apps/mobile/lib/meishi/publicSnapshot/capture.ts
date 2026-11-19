import type { RefObject } from "react";
import type { ViewInstance } from "react-native";

export async function capturePublicSnapshot(
  _ref: RefObject<ViewInstance | null>,
): Promise<Blob> {
  throw new Error("Platform implementation unavailable");
}
