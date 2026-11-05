import {
  AVATAR_MAX_DIMENSION,
  MEISHI_IMAGE_MAX_BYTES,
  MEISHI_IMAGE_MAX_DIMENSION,
  calcResizedSize,
  compressAvatarImage,
  compressMeishiImage,
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
  SaveFormat: { WEBP: "webp", JPEG: "jpeg" },
}));

// 保存後のファイルサイズ確認（fetch(uri).blob().size）を差し替える。
const mockSavedSizes = (...sizes: number[]) => {
  const fetchMock = jest.fn();
  for (const size of sizes) {
    fetchMock.mockResolvedValueOnce({ blob: async () => ({ size }) });
  }
  global.fetch = fetchMock;
};

beforeEach(() => {
  jest.clearAllMocks();
  (ImageManipulator.manipulate as jest.Mock).mockImplementation(manipulate);
  mockSavedSizes(100 * 1024);
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
  it("resize → renderAsync → saveAsync のチェーンを呼び、Content-Type 用の mimeType を返す（ネイティブは WebP）", async () => {
    const result = await compressAvatarImage("file:///in.jpg", {
      width: 1024,
      height: 512,
    });

    expect(manipulate).toHaveBeenCalledWith("file:///in.jpg");
    expect(resize).toHaveBeenCalledWith({ width: 512, height: 256 });
    expect(renderAsync).toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith({ format: SaveFormat.WEBP });
    expect(result).toEqual({ uri: "file:///out.webp", mimeType: "image/webp" });
  });
});

describe("compressMeishiImage", () => {
  it("最大辺を 1024px の WebP に圧縮する（API の 500KB 上限対策で compress 指定あり）", async () => {
    const result = await compressMeishiImage("file:///in.jpg", {
      width: 4096,
      height: 2048,
    });

    expect(manipulate).toHaveBeenCalledWith("file:///in.jpg");
    expect(resize).toHaveBeenCalledWith({ width: 1024, height: 512 });
    expect(saveAsync).toHaveBeenCalledWith({
      format: SaveFormat.WEBP,
      compress: 0.8,
    });
    expect(result).toEqual({ uri: "file:///out.webp", mimeType: "image/webp" });
  });

  it("1024px 未満の画像は拡大しない", async () => {
    await compressMeishiImage("file:///small.jpg", {
      width: 400,
      height: 300,
    });

    expect(resize).toHaveBeenCalledWith({ width: 400, height: 300 });
  });

  it("上限を超えたら品質、次に寸法を下げて保存し直す", async () => {
    mockSavedSizes(
      MEISHI_IMAGE_MAX_BYTES + 1,
      MEISHI_IMAGE_MAX_BYTES + 1,
      MEISHI_IMAGE_MAX_BYTES,
    );

    await compressMeishiImage("file:///in.jpg", { width: 2048, height: 2048 });

    expect(saveAsync.mock.calls.map(([opts]) => opts.compress)).toEqual([
      0.8, 0.6, 0.6,
    ]);
    expect(resize.mock.calls.map(([size]) => size.width)).toEqual([
      1024, 1024, 768,
    ]);
  });

  it("最後まで上限に収まらなければ最後の結果を返す（エラーは API に任せる）", async () => {
    mockSavedSizes(...Array(4).fill(MEISHI_IMAGE_MAX_BYTES + 1));

    const result = await compressMeishiImage("file:///in.jpg", {
      width: 2048,
      height: 2048,
    });

    expect(saveAsync).toHaveBeenCalledTimes(4);
    expect(resize).toHaveBeenLastCalledWith({ width: 512, height: 512 });
    expect(result).toEqual({ uri: "file:///out.webp", mimeType: "image/webp" });
  });

  it("MEISHI_IMAGE_MAX_DIMENSION は 1024", () => {
    expect(MEISHI_IMAGE_MAX_DIMENSION).toBe(1024);
  });
});
