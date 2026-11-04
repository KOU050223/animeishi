// イベント（issue #411）の会期表示ロジック。
// API が返す ISO 8601 文字列の startsAt / endsAt を画面表示用に整形する。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

// 開催日は日本での日付（Asia/Tokyo）で表示する。対象は国内イベント
// （コミケ・AnimeJapan 等）で、端末が海外タイムゾーンだと現地日付で
// ずれて見えるため。日本時間は常に UTC+9 でサマータイムが無いので、
// 固定オフセットで計算する。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const toJst = (d: Date) => new Date(d.getTime() + JST_OFFSET_MS);

const isSameJstDay = (a: Date, b: Date) => {
  const ja = toJst(a);
  const jb = toJst(b);
  return (
    ja.getUTCFullYear() === jb.getUTCFullYear() &&
    ja.getUTCMonth() === jb.getUTCMonth() &&
    ja.getUTCDate() === jb.getUTCDate()
  );
};

const formatJstDay = (d: Date, withYear: boolean) => {
  const j = toJst(d);
  return `${withYear ? `${j.getUTCFullYear()}年` : ""}${j.getUTCMonth() + 1}月${j.getUTCDate()}日(${WEEKDAYS[j.getUTCDay()]})`;
};

/**
 * 「2026年12月20日(日)〜12月21日(月)」のような会期表記にする。
 * 同日なら 1 日分だけ。年をまたぐときは終了側にも年を付ける。
 * 日付の区切りは日本時間（Asia/Tokyo）基準。解釈できない日時は空文字を返す。
 */
export function formatEventPeriod(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";

  if (isSameJstDay(start, end)) return formatJstDay(start, true);
  const js = toJst(start);
  const je = toJst(end);
  if (js.getUTCFullYear() === je.getUTCFullYear()) {
    return `${formatJstDay(start, true)}〜${formatJstDay(end, false)}`;
  }
  return `${formatJstDay(start, true)}〜${formatJstDay(end, true)}`;
}

export type EventPhase = "before" | "ongoing" | "ended";

/**
 * now が会期のどこにあるかを返す。会期は両端を含む
 * （API の「会期中に交換した名刺」の判定と同じ区間）。
 */
export function eventPhase(
  startsAt: string,
  endsAt: string,
  now: Date = new Date(),
): EventPhase {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (now < start) return "before";
  if (now > end) return "ended";
  return "ongoing";
}
