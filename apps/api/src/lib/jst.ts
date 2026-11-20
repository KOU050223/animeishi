// JST（Asia/Tokyo）は常に UTC+9 で夏時間がないため、固定オフセットで
// 暦日を取れる。UTC の暦日でまとめると JST 9:00 に日付が切り替わり、
// 同じ午前のイベント内での行為が別日に分かれてしまう（issue #662）。
// 「同日は 1 回」の判定は exchange_records（#662）と friend_thanks
// （#694）で共通のためここに置く。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** d が収まる日本時間（UTC+9）の暦日範囲（同日判定用）。 */
export function jstDayRange(d: Date): { start: Date; end: Date } {
  const shifted = new Date(d.getTime() + JST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  const start = new Date(shifted.getTime() - JST_OFFSET_MS);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
