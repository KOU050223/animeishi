import {
  AVATAR_MAX_DIMENSION,
  calcResizedSize,
  compressAvatarImage,
} from "@/lib/imageCompression";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

// expo-image-manipulator はネイティブモジュールのため、ロジックテストではモックする。
// manipulate().resize().renderAsync().saveAsync() のチェーンを再現する。
const saveAsync = jest.fn().mockResolvedValue({ uri: "file:///out.webp" });
const renderAsync = jest.fn().mockResolvedValue({ saveAsync });
const resize = jest.fn().mockReturnValue({ renderAsync });
const manipulate = jest.fn().mockReturnValue({ resize });

jest.mock("expo-image-manipulator", () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { WEBP: "webp" },
}));

beforeEach(() => {
  jest.clearAllMocks();
  (ImageManipulator.manipulate as jest.Mock).mockImplementation(manipulate);
});

describe("calcResizedSize", () => {
  it("最大辺を 512px に縮小する（横長）", () => {
    expect(calcResizedSize({ width: 1024, height: 512 })).toEqual({
      width: 512,
      height: 256,
    });
  });

  it("最大辺を 512px に縮小する（縦長）", () => {
    expect(calcResizedSize({ width: 512, height: 1024 })).toEqual({
      width: 256,
      height: 512,
    });
  });

  it("正方形は 512x512 に縮小する", () => {
    expect(calcResizedSize({ width: 2048, height: 2048 })).toEqual({
      width: 512,
      height: 512,
    });
  });

  it("アスペクト比を保持する", () => {
    const result = calcResizedSize({ width: 3000, height: 2000 });
    expect(result.width).toBe(512);
    // 2000/3000 * 512 ≈ 341
    expect(result.height).toBe(341);
  });

  it("最大辺が 512px ちょうどならそのまま返す", () => {
    expect(calcResizedSize({ width: 512, height: 300 })).toEqual({
      width: 512,
      height: 300,
    });
  });

  it("512px 未満の画像は拡大せずそのまま返す", () => {
    expect(calcResizedSize({ width: 200, height: 100 })).toEqual({
      width: 200,
      height: 100,
    });
  });

  it("AVATAR_MAX_DIMENSION は 512", () => {
    expect(AVATAR_MAX_DIMENSION).toBe(512);
  });

  it("maxDimension を上書きできる", () => {
    expect(calcResizedSize({ width: 800, height: 400 }, 256)).toEqual({
      width: 256,
      height: 128,
    });
  });
});

describe("compressAvatarImage", () => {
  it("resize → renderAsync → saveAsync(WEBP) のチェーンを呼ぶ", async () => {
    const result = await compressAvatarImage("file:///in.jpg", {
      width: 1024,
      height: 512,
    });

    // API 側は image/webp 前提で受けるため、WEBP 出力を固定する
    expect(manipulate).toHaveBeenCalledWith("file:///in.jpg");
    expect(resize).toHaveBeenCalledWith({ width: 512, height: 256 });
    expect(renderAsync).toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith({ format: SaveFormat.WEBP });
    expect(result).toEqual({ uri: "file:///out.webp" });
  });
});
