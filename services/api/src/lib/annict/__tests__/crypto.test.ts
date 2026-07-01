import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "../crypto";

// テスト用の 32byte 鍵（base64）を実行時に生成する。固定の base64 文字列を埋め込むと
// シークレットスキャン（Betterleaks 等）に誤検知され、本物の漏えいが埋もれるため。
function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

const TEST_KEY = generateKey();

describe("encryptToken / decryptToken", () => {
  it("暗号化したトークンを復号すると元に戻る", async () => {
    const plain = "annict_access_token_abc123";
    const encrypted = await encryptToken(plain, TEST_KEY);
    const decrypted = await decryptToken(encrypted, TEST_KEY);
    expect(decrypted).toBe(plain);
  });

  it("暗号文には平文が含まれない", async () => {
    const plain = "super_secret_token";
    const encrypted = await encryptToken(plain, TEST_KEY);
    expect(encrypted).not.toContain(plain);
  });

  it("同じ平文でも毎回異なる暗号文になる（IV がランダム）", async () => {
    const plain = "same_token";
    const a = await encryptToken(plain, TEST_KEY);
    const b = await encryptToken(plain, TEST_KEY);
    expect(a).not.toBe(b);
    // どちらも正しく復号できる。
    expect(await decryptToken(a, TEST_KEY)).toBe(plain);
    expect(await decryptToken(b, TEST_KEY)).toBe(plain);
  });

  it("異なる鍵では復号できない（改ざん/鍵不一致で例外）", async () => {
    const otherKey = generateKey();
    const encrypted = await encryptToken("token", TEST_KEY);
    await expect(decryptToken(encrypted, otherKey)).rejects.toThrow();
  });

  it("壊れた暗号文は復号に失敗する", async () => {
    await expect(
      decryptToken("not-a-valid-ciphertext", TEST_KEY),
    ).rejects.toThrow();
  });
});
