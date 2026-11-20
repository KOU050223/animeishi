// 抽出結果 JSON の境界検証。WebView の postMessage / ブックマークレット由来の
// 貼り付けテキストはどちらも「アプリの外から来た入力」なので、要素の形を
// ここで検証してから集約・レビュー処理に渡す。
import {
  DANIME_EXTRACT_SCHEMA_VERSION,
  type DanimeExtractedEpisode,
  type DanimeExtractedLists,
  type DanimeExtractedWork,
} from "./types";

// 話データ 1 件の境界検証。partId が無いものは対応付けに使えないので落とす。
function isEpisode(value: unknown): value is DanimeExtractedEpisode {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.partId === "string" && e.partId.length > 0;
}

// workId → 話配列のマップを検証する。壊れた要素だけ落とし、残りは救済する。
function normalizeEpisodes(
  value: unknown,
): Record<string, DanimeExtractedEpisode[]> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const out: Record<string, DanimeExtractedEpisode[]> = {};
  for (const [workId, list] of Object.entries(value)) {
    if (!Array.isArray(list)) continue;
    const episodes = (list as unknown[]).filter(isEpisode).map((e) => ({
      partId: e.partId,
      watched: e.watched === true,
      label: typeof e.label === "string" ? e.label : "",
      subtitle: typeof e.subtitle === "string" ? e.subtitle : "",
    }));
    if (episodes.length > 0) out[workId] = episodes;
  }
  return out;
}

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
  const result: DanimeExtractedLists = {
    schemaVersion: DANIME_EXTRACT_SCHEMA_VERSION,
    completed,
    history,
  };
  // 所要時間の可視化用の抽出時間。任意項目で、数値でない値は落とす
  // （exactOptionalPropertyTypes のため undefined 代入せず欠落させる）。
  if (
    typeof v.extractElapsedMs === "number" &&
    Number.isFinite(v.extractElapsedMs) &&
    v.extractElapsedMs >= 0
  ) {
    result.extractElapsedMs = v.extractElapsedMs;
  }
  if (v.episodes !== undefined) {
    const episodes = normalizeEpisodes(v.episodes);
    if (episodes) result.episodes = episodes;
  }
  if (
    typeof v.episodeFetchFailures === "number" &&
    Number.isFinite(v.episodeFetchFailures) &&
    v.episodeFetchFailures >= 0
  ) {
    result.episodeFetchFailures = v.episodeFetchFailures;
  }
  return result;
}
