// 抽出結果（completed / history）をマッチ API の works[] 入力に集約する純粋関数。
//
// ルール:
//   - completed に含まれる作品は WATCHED 対象。
//   - history にのみ含まれる作品は WATCHING 対象。
//   - 同一作品が両方に出た場合は completed（WATCHED）が優先される。
//     両リストに同一作品が残ると WATCHED → WATCHING の順で登録されて
//     視聴済みが視聴中に降格してしまうため、workId 一致に加えて
//     正規化タイトル一致でも history 側を落とす
//     （dアニメ側で同一作品に別 workId が振られるケースへの保険）。
import type { DanimeExtractedLists } from "@/lib/danime/types";

export type DanimeMatchWorkInput = {
  danimeWorkId: string;
  title: string;
  targetState: "WATCHED" | "WATCHING";
};

// API 側 titleNormalize と同等の軽量正規化（NFKC・小文字化・空白/中黒除去）。
// 「同一作品か」の粗い判定用で、API のスコアリングとは独立に持つ。
function normalize(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[・･\s　]/g, "");
}

export function toMatchWorks(
  lists: DanimeExtractedLists,
): DanimeMatchWorkInput[] {
  const byKey = new Map<string, DanimeMatchWorkInput>();
  const completedTitles = new Set(
    lists.completed.map((w) => normalize(w.title)).filter(Boolean),
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
    // completed の同名作品は WATCHED で登録予定なので履歴側を弾く。
    if (completedTitles.has(normalize(w.title))) continue;
    byKey.set(w.workId, {
      danimeWorkId: w.workId,
      title: w.title,
      targetState: "WATCHING",
    });
  }
  return [...byKey.values()];
}
