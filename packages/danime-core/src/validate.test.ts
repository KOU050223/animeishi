import { describe, expect, it } from "vitest";
import { DANIME_EXTRACT_SCHEMA_VERSION } from "./types";
import { parseDanimeExtractedLists } from "./validate";

const VALID_WORK = { workId: "1", title: "作品A", partIds: ["101"] };

describe("parseDanimeExtractedLists", () => {
  it("現行 schemaVersion のペイロードを受理する", () => {
    const lists = parseDanimeExtractedLists({
      schemaVersion: DANIME_EXTRACT_SCHEMA_VERSION,
      completed: [VALID_WORK],
      history: [],
    });
    expect(lists).not.toBeNull();
    expect(lists?.schemaVersion).toBe(DANIME_EXTRACT_SCHEMA_VERSION);
    expect(lists?.completed).toEqual([VALID_WORK]);
  });

  it("schemaVersion 未付与のペイロードは現行扱いで補完する", () => {
    const lists = parseDanimeExtractedLists({
      completed: [],
      history: [VALID_WORK],
    });
    expect(lists?.schemaVersion).toBe(DANIME_EXTRACT_SCHEMA_VERSION);
  });

  it("未知の schemaVersion は弾く（誤読防止）", () => {
    expect(
      parseDanimeExtractedLists({
        schemaVersion: DANIME_EXTRACT_SCHEMA_VERSION + 1,
        completed: [],
        history: [],
      }),
    ).toBeNull();
    expect(
      parseDanimeExtractedLists({
        schemaVersion: "1",
        completed: [],
        history: [],
      }),
    ).toBeNull();
  });

  it("extractElapsedMs があれば通し、無ければ undefined のままにする", () => {
    const valid = {
      completed: [VALID_WORK],
      history: [],
    };
    expect(
      parseDanimeExtractedLists({ ...valid, extractElapsedMs: 1234 })
        ?.extractElapsedMs,
    ).toBe(1234);
    expect(parseDanimeExtractedLists(valid)?.extractElapsedMs).toBeUndefined();
  });

  it("extractElapsedMs が数値でなければ落とす", () => {
    expect(
      parseDanimeExtractedLists({
        completed: [],
        history: [],
        extractElapsedMs: "1.2秒",
      })?.extractElapsedMs,
    ).toBeUndefined();
    expect(
      parseDanimeExtractedLists({
        completed: [],
        history: [],
        extractElapsedMs: -1,
      })?.extractElapsedMs,
    ).toBeUndefined();
  });

  it("completed / history が配列でなければ null", () => {
    expect(parseDanimeExtractedLists({ completed: {} })).toBeNull();
    expect(parseDanimeExtractedLists(null)).toBeNull();
    expect(parseDanimeExtractedLists("[]")).toBeNull();
  });

  it("partIds 欠落は空配列に正規化する", () => {
    const lists = parseDanimeExtractedLists({
      completed: [],
      history: [{ workId: "1", title: "作品A" }],
    });
    expect(lists?.history[0]?.partIds).toEqual([]);
  });

  it("episodes マップを検証・正規化して通す", () => {
    const lists = parseDanimeExtractedLists({
      completed: [],
      history: [VALID_WORK],
      episodes: {
        "1": [
          { partId: "00001", watched: true, label: "第1話", subtitle: "サブ" },
          // label/subtitle 欠落は空文字に補完、watched の非真値は false。
          { partId: "00002" },
          // partId の無い要素は対応付けに使えないので落とす。
          { watched: true },
        ],
        "2": "壊れた値", // 配列でない workId エントリは落とす
      },
      episodeFetchFailures: 2,
    });
    expect(lists?.episodes?.["1"]).toEqual([
      { partId: "00001", watched: true, label: "第1話", subtitle: "サブ" },
      { partId: "00002", watched: false, label: "", subtitle: "" },
    ]);
    expect(lists?.episodes?.["2"]).toBeUndefined();
    expect(lists?.episodeFetchFailures).toBe(2);
  });

  it("episodes が無い旧ペイロードも受理する", () => {
    const lists = parseDanimeExtractedLists({
      completed: [],
      history: [VALID_WORK],
    });
    expect(lists?.episodes).toBeUndefined();
  });

  it("workId が空文字や非文字列の要素は弾く", () => {
    expect(
      parseDanimeExtractedLists({
        completed: [],
        history: [{ workId: "", title: "作品A", partIds: [] }],
      }),
    ).toBeNull();
    expect(
      parseDanimeExtractedLists({
        completed: [],
        history: [{ workId: 1, title: "作品A", partIds: [] }],
      }),
    ).toBeNull();
  });
});
