// 抽出結果 JSON の境界検証。WebView の postMessage / ブックマークレット由来の
// 貼り付けテキストはどちらも「アプリの外から来た入力」なので、要素の形を
// ここで検証してから集約・レビュー処理に渡す。
import {
  DANIME_EXTRACT_SCHEMA_VERSION,
  type DanimeExtractedLists,
  type DanimeExtractedWork,
} from "./types";

function isWork(value: unknown): value is DanimeExtractedWork {
  if (typeof value !== "object" || value === null) return false;
  const w = value as Record<string, unknown>;
  return (
    typeof w.workId === "string" &&
    w.workId.length > 0 &&
    typeof w.title === "string" &&
    Array.isArray(w.partIds) &&
    w.partIds.every((p) => typeof p === "string")
  );
}

/**
 * 抽出ペイロードを DanimeExtractedLists として検証する。
 * 不正なら null。partIds が欠落した要素は許容して正規化する
 * （スクリプトの古い版や手書き JSON を救済するため）。
 * schemaVersion は現行値のみ受理する。未付与のペイロードは
 * バージョン導入前のものとして現行扱いに補完し、
 * 未知のバージョン（新しいフォーマット等）は誤読を避けて弾く。
 */
export function parseDanimeExtractedLists(
  value: unknown,
): DanimeExtractedLists | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (
    v.schemaVersion !== undefined &&
    v.schemaVersion !== DANIME_EXTRACT_SCHEMA_VERSION
  ) {
    return null;
  }
  if (!Array.isArray(v.completed) || !Array.isArray(v.history)) return null;

  const normalize = (list: unknown[]): DanimeExtractedWork[] | null => {
    const out: DanimeExtractedWork[] = [];
    for (const item of list) {
      const w =
        typeof item === "object" && item !== null
          ? { partIds: [], ...(item as Record<string, unknown>) }
          : item;
      if (!isWork(w)) return null;
      out.push(w);
    }
    return out;
  };

  const completed = normalize(v.completed);
  const history = normalize(v.history);
  if (!completed || !history) return null;
  return {
    schemaVersion: DANIME_EXTRACT_SCHEMA_VERSION,
    completed,
    history,
  };
}
