// 抽出結果（completed / history）をマッチ API の works[] 入力に集約する純粋関数。
//
// ルール:
//   - completed に含まれる作品は WATCHED 対象。
//   - history にのみ含まれる作品は WATCHING 対象。
//   - 同一作品が両方に出た場合は completed（WATCHED）が優先される。
//   - history 側の疑似キー（"title:..."）は completed の workId と一致しないため、
//     タイトル一致でも completed 側を優先して history 側を落とす。
import type { DanimeExtractedLists } from "@/lib/danime/types";

export type DanimeMatchWorkInput = {
  danimeWorkId: string;
  title: string;
  targetState: "WATCHED" | "WATCHING";
};

export function toMatchWorks(
  lists: DanimeExtractedLists,
): DanimeMatchWorkInput[] {
  const byKey = new Map<string, DanimeMatchWorkInput>();
  const completedTitles = new Set(
    lists.completed.map((w) => w.title.trim()).filter(Boolean),
  );

  for (const w of lists.completed) {
    byKey.set(w.workId, {
      danimeWorkId: w.workId,
      title: w.title,
      targetState: "WATCHED",
    });
  }
  for (const w of lists.history) {
    if (byKey.has(w.workId)) continue;
    // 疑似キーの履歴カードが completed の同名作品と重複する場合は弾く。
    if (w.workId.startsWith("title:") && completedTitles.has(w.title.trim())) {
      continue;
    }
    byKey.set(w.workId, {
      danimeWorkId: w.workId,
      title: w.title,
      targetState: "WATCHING",
    });
  }
  return [...byKey.values()];
}
