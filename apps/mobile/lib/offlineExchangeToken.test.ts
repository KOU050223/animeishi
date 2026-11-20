import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  readOfflineExchangeToken,
  saveOfflineExchangeToken,
} from "@/lib/offlineExchangeToken";

const USER_ID = "user_2abcDEF1234567890ghijKLMN";
const NOW_SEC = 1_760_000_000;

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe("offlineExchangeToken", () => {
  it("保存した ot を期限内なら読み出せる", async () => {
    await saveOfflineExchangeToken({
      userId: USER_ID,
      token: "ot-token",
      expiresAt: NOW_SEC + 60 * 60,
    });

    await expect(readOfflineExchangeToken(USER_ID, NOW_SEC)).resolves.toBe(
      "ot-token",
    );
  });

  it("期限切れの ot は読み出さない", async () => {
    await saveOfflineExchangeToken({
      userId: USER_ID,
      token: "ot-token",
      expiresAt: NOW_SEC,
    });

    await expect(
      readOfflineExchangeToken(USER_ID, NOW_SEC),
    ).resolves.toBeNull();
  });

  it("別ユーザーの ot は読み出さない（前ユーザーのトークンを QR に載せない）", async () => {
    await saveOfflineExchangeToken({
      userId: "user_other",
      token: "ot-token",
      expiresAt: NOW_SEC + 60 * 60,
    });

    await expect(
      readOfflineExchangeToken(USER_ID, NOW_SEC),
    ).resolves.toBeNull();
  });

  it("未保存なら null", async () => {
    await expect(
      readOfflineExchangeToken(USER_ID, NOW_SEC),
    ).resolves.toBeNull();
  });

  it("壊れた JSON が残っていても null を返す", async () => {
    await AsyncStorage.setItem("offlineExchangeToken:v1", "not-json{");

    await expect(
      readOfflineExchangeToken(USER_ID, NOW_SEC),
    ).resolves.toBeNull();
  });

  it("読み出しに失敗しても例外を投げず null を返す", async () => {
    jest
      .spyOn(AsyncStorage, "getItem")
      .mockRejectedValue(new Error("storage error"));

    await expect(
      readOfflineExchangeToken(USER_ID, NOW_SEC),
    ).resolves.toBeNull();
  });

  it("保存に失敗しても例外を投げない", async () => {
    jest
      .spyOn(AsyncStorage, "setItem")
      .mockRejectedValue(new Error("storage error"));

    await expect(
      saveOfflineExchangeToken({
        userId: USER_ID,
        token: "ot-token",
        expiresAt: NOW_SEC + 60 * 60,
      }),
    ).resolves.toBeUndefined();
  });
});
