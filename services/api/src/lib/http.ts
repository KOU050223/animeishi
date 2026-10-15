// HTTP レスポンスのボディ読み取りに関する小物ユーティリティ。

/**
 * レスポンスボディを maxBytes までストリーム読みする。
 * 超過が確定した時点で reader.cancel() して中断し、残りを受け取らない。
 * 読み取り自体の失敗（切断・シグナル発火）は tooLarge: false の失敗として返す。
 * content-length の無い応答を arrayBuffer() で読むと全量メモリに乗るため、
 * 外部から画像等を取り込む経路ではこちらを使う。
 */
export async function readBodyWithLimit(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<{ ok: true; data: ArrayBuffer } | { ok: false; tooLarge: boolean }> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (stream) {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return { ok: false, tooLarge: true };
        }
        chunks.push(value);
      }
    } catch {
      return { ok: false, tooLarge: false };
    } finally {
      reader.releaseLock();
    }
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, data: data.buffer };
}
