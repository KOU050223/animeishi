// イベント（issue #411）の会期表示ロジック。
// API が返す ISO 8601 文字列の startsAt / endsAt を画面表示用に整形する。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

const formatDay = (d: Date, withYear: boolean) =>
  `${withYear ? `${d.getFullYear()}年` : ""}${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAYS[d.getDay()]})`;

/**
 * 「2026年12月20日(日)〜12月21日(月)」のような会期表記にする。
 * 同日なら 1 日分だけ。年をまたぐときは終了側にも年を付ける。
 * 解釈できない日時は空文字を返す。
 */
export function formatEventPeriod(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "";

  if (isSameDay(start, end)) return formatDay(start, true);
  if (start.getFullYear() === end.getFullYear()) {
    return `${formatDay(start, true)}〜${formatDay(end, false)}`;
  }
  return `${formatDay(start, true)}〜${formatDay(end, true)}`;
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
