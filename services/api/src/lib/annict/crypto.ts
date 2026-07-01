// Annict アクセストークンを D1 に保存する際の暗号化ユーティリティ。
// Web(ブラウザ)連携ではサーバーがトークンを保持するため、平文で D1 に置かず
// AES-GCM で暗号化する。鍵は Workers Secret `ANNICT_ENCRYPTION_KEY`(32byte base64)。
//
// 形式: base64(iv[12] || ciphertext(+tag))。IV はトークンごとにランダム生成する。

const IV_LENGTH = 12; // AES-GCM 推奨 IV 長（96bit）。

// SharedArrayBuffer 由来の Uint8Array を避け、必ず ArrayBuffer 実体で確保する。
// crypto.subtle は BufferSource(ArrayBufferView<ArrayBuffer>) を要求するため、
// モバイルの DOM 型チェック（AppType 推論経由）でも矛盾しないようにする。
function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// base64 の 32byte 鍵から AES-GCM CryptoKey をインポートする。
async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = base64ToBytes(keyBase64);
  if (raw.length !== 32) {
    throw new Error(
      "ANNICT_ENCRYPTION_KEY は base64 エンコードした 32byte でなければなりません",
    );
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** 平文トークンを AES-GCM で暗号化し base64(iv||ciphertext) を返す。 */
export async function encryptToken(
  plain: string,
  keyBase64: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LENGTH)));
  const encoded = new Uint8Array(new TextEncoder().encode(plain));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );
  const cipher = new Uint8Array(cipherBuf);
  const combined = new Uint8Array(iv.length + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, iv.length);
  return bytesToBase64(combined);
}

/** encryptToken で作った base64(iv||ciphertext) を復号する。改ざん/鍵不一致は throw。 */
export async function decryptToken(
  encrypted: string,
  keyBase64: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const combined = base64ToBytes(encrypted);
  if (combined.length <= IV_LENGTH) {
    throw new Error("暗号文が不正です（IV 長に満たない）");
  }
  const iv = combined.slice(0, IV_LENGTH);
  const cipher = combined.slice(IV_LENGTH);
  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    cipher,
  );
  return new TextDecoder().decode(plainBuf);
}
