import { captureTierListImageFile } from "@/lib/tierList/share";
import type { RefObject } from "react";
import type { ViewInstance } from "react-native";

export async function capturePublicSnapshot(
  ref: RefObject<ViewInstance | null>,
): Promise<Blob> {
  return captureTierListImageFile(ref, {
    title: "meishi",
    backgroundColor: "#ffffff",
  });
}
