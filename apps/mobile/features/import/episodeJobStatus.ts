// 話記録ジョブ（issue #477）の状態 → 表示テキスト。
// 取り込み画面・レビュー結果画面・プロフィールで共有する。
import type { TFunction } from "i18next";
import type { DanimeEpisodeJob } from "./useDanimeImport";

export function episodeJobStatusText(
  job: DanimeEpisodeJob,
  t: TFunction,
): string {
  switch (job.status) {
    case "matching":
      return t("話の対応付けをしています…");
    case "writing": {
      const remaining = Math.max(job.total - job.done - job.failed, 0);
      return t(
        "話を記録しています（残り {{remaining}} 件・失敗 {{failed}} 件）",
        { remaining, failed: job.failed },
      );
    }
    case "completed":
      return t(
        "話の記録が完了しました（{{done}} 件・失敗 {{failed}} 件・スキップ {{skipped}} 件）",
        { done: job.done, failed: job.failed, skipped: job.skipped },
      );
    case "failed":
      return t("話の記録に失敗しました");
  }
}
