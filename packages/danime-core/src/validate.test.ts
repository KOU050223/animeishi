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
