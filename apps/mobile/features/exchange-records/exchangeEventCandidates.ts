// 交換記録に付けるイベント候補の絞り込み・並べ替え（issue #661）。
// 純粋関数にして vitest（*.unit.test.ts）で検証する。
//
// 仕様:
// - 土台は「当日開催中（startsAt <= now <= endsAt）」の登録イベント
// - 場所が解決できているとき、場所テキストとイベントの開催地が
//   一致するものを優先表示する。近いイベントを優先しても、
//   残りの当日イベントは優先度を下げるだけで候補から外さない
// - 自由入力は呼び出し側（シート）が常時用意する

export type EventCandidate = {
  slug: string;
  title: string;
  location: string | null;
  startsAt: string;
  endsAt: string;
};

export type RankedEventCandidate = EventCandidate & {
  /** 場所テキストと開催地が一致した候補（優先表示）。 */
  nearby: boolean;
};

// 地名の比較は「どちらかがどちらかを含む」で見る
// （登録が「東京ビッグサイト」で逆ジオコードが「東京ビッグサイト東棟」
// のような片寄せでも拾うため）。空白・大小文字差は潰す。
function normalizePlaceText(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

export function isNearbyEvent(
  placeName: string | null | undefined,
  eventLocation: string | null,
): boolean {
  if (!placeName || !eventLocation) return false;
  const a = normalizePlaceText(placeName);
  const b = normalizePlaceText(eventLocation);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * 当日開催中のイベントだけを残し、場所が取れていれば近いものを先頭に
 * 寄せて返す。元の並び（API の会期開始昇順）は同順位内で保持する。
 */
export function rankEventCandidates(
  events: EventCandidate[],
  opts: { now: Date; placeName?: string | null },
): RankedEventCandidate[] {
  const now = opts.now.getTime();
  const active = events.filter((event) => {
    const starts = new Date(event.startsAt).getTime();
    const ends = new Date(event.endsAt).getTime();
    return starts <= now && now <= ends;
  });
  const ranked = active.map((event) => ({
    ...event,
    nearby: isNearbyEvent(opts.placeName, event.location),
  }));
  // nearby=true を前に。Array.prototype.sort は安定なので元順は保たれる。
  return ranked.sort((a, b) => Number(b.nearby) - Number(a.nearby));
}
