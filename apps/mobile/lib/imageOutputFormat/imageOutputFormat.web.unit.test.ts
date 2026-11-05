// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resetImageOutputFormatCache,
  resolveImageOutputFormat,
} from "./imageOutputFormat.web";

vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { WEBP: "webp", JPEG: "jpeg" },
}));

afterEach(() => {
  resetImageOutputFormatCache();
  vi.restoreAllMocks();
});

describe("resolveImageOutputFormat (web)", () => {
  it("canvas が WebP を書き出せるブラウザでは WebP を使う", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/webp;base64,AAAA",
    );
    expect(resolveImageOutputFormat()).toEqual({
      format: "webp",
      mimeType: "image/webp",
    });
  });

  it("WebP を書き出せないブラウザ（iOS Safari 等）では JPEG に落とす", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
      "data:image/png;base64,AAAA",
    );
    expect(resolveImageOutputFormat()).toEqual({
      format: "jpeg",
      mimeType: "image/jpeg",
    });
  });
});
