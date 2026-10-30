import { describe, it, expect } from "vitest";
import { attachInsights, buildSectionDrafts } from "@/features/analysis/report";
import type { WatchHistoryWithWork } from "@/features/watch-history/repository";

// レポート集計（issue #375）の単体テスト。件数・割合・根拠作品は
// すべてここで確定する（LLM には解釈文だけを書かせる）ため、
// 集計の正しさを直接検証する。
const row = (
  over: Partial<WatchHistoryWithWork> & { annictWorkId: number },
): WatchHistoryWithWork => ({
  id: over.annictWorkId,
  userId: "u",
  state: "WATCHED",
  updatedAt: new Date(),
  title: `作品${over.annictWorkId}`,
  titleKana: null,
  titleEn: null,
  seasonName: null,
  seasonYear: null,
  imageUrl: null,
  resolvedImageUrl: null,
  imageSource: null,
  imageR2Key: null,
  watchersCount: null,
  genres: null,
  ...over,
});

const section = (drafts: ReturnType<typeof buildSectionDrafts>, key: string) =>
  drafts.find((d) => d.key === key);

describe("buildSectionDrafts", () => {
  it("よく見るジャンル: 件数・割合・根拠作品を集計する", () => {
    const drafts = buildSectionDrafts([
      row({ annictWorkId: 1, genres: ["Action", "Drama"] }),
      row({ annictWorkId: 2, genres: ["Action"] }),
      row({ annictWorkId: 3, genres: ["Comedy"] }),
      row({ annictWorkId: 4, genres: null }), // 未取得は集計対象外
      row({ annictWorkId: 5, genres: ["Action"], state: "WANNA_WATCH" }), // 視聴予定は対象外
    ]);
    const genres = section(drafts, "genres");
    expect(genres).toBeDefined();
    // Action は視聴開始済みの 3 件中 2 件（id 5 は WANNA_WATCH で除外）。
    const actionFact = genres!.facts.find((f) => f.label === "Action");
    expect(actionFact?.value).toBe("2 件（67%）");
    expect(genres!.facts.find((f) => f.label === "集計対象")?.value).toContain(
      "3 / 4",
    );
    // 根拠作品はトップジャンルを持つ実在作品だけ。
    expect(genres!.evidenceWorks.map((w) => w.annictWorkId)).toEqual([1, 2]);
    expect(genres!.fallbackInsight).toContain("Action");
    expect(genres!.fallbackInsight).toContain("2 件");
  });

  it("よく見る時期: 放送年ごとの件数と根拠作品を集計する", () => {
    const drafts = buildSectionDrafts([
      row({ annictWorkId: 1, seasonYear: 2024 }),
      row({ annictWorkId: 2, seasonYear: 2024 }),
      row({ annictWorkId: 3, seasonYear: 2020 }),
      row({ annictWorkId: 4, seasonYear: null }),
    ]);
    const seasons = section(drafts, "seasons");
    const yearFact = seasons!.facts.find((f) => f.label === "2024 年");
    expect(yearFact?.value).toBe("2 件（67%）");
    expect(seasons!.evidenceWorks.map((w) => w.annictWorkId)).toEqual([1, 2]);
    expect(seasons!.fallbackInsight).toContain("2024");
  });

  it("完走・断念: 開始した作品を母数に視聴済・断念の割合を出す", () => {
    const drafts = buildSectionDrafts([
      row({ annictWorkId: 1, state: "WATCHED" }),
      row({ annictWorkId: 2, state: "WATCHED" }),
      row({ annictWorkId: 3, state: "STOP_WATCHING" }),
      row({ annictWorkId: 4, state: "WANNA_WATCH" }),
    ]);
    const completion = section(drafts, "completion")!;
    // 開始 3 件のうち視聴済 2 件（67%）、断念 1 件（33%）。
    expect(completion.facts.find((f) => f.label === "視聴済")?.value).toBe(
      "2 件（開始した作品の 67%）",
    );
    expect(completion.facts.find((f) => f.label === "断念")?.value).toBe(
      "1 件（開始した作品の 33%）",
    );
    expect(completion.facts.find((f) => f.label === "視聴予定")?.value).toBe(
      "1 件",
    );
    // 断念・一時停止があればそれを根拠に出す。
    expect(completion.evidenceWorks.map((w) => w.annictWorkId)).toEqual([3]);
    expect(completion.fallbackInsight).toContain("67%");
  });

  it("完走・断念: 断念・一時停止が無ければ視聴済み作品を根拠にする", () => {
    const drafts = buildSectionDrafts([
      row({ annictWorkId: 1, state: "WATCHED" }),
      row({ annictWorkId: 2, state: "WATCHED" }),
    ]);
    const completion = section(drafts, "completion")!;
    expect(completion.evidenceWorks.map((w) => w.annictWorkId)).toEqual([1, 2]);
  });

  it("作品の人気度: 視聴者数の中央値と区分を集計する", () => {
    const drafts = buildSectionDrafts([
      row({ annictWorkId: 1, watchersCount: 2000 }),
      row({ annictWorkId: 2, watchersCount: 500 }),
      row({ annictWorkId: 3, watchersCount: 30 }),
      row({ annictWorkId: 4, watchersCount: null }),
    ]);
    const popularity = section(drafts, "popularity")!;
    expect(
      popularity.facts.find((f) => f.label === "視聴者数の中央値")?.value,
    ).toBe("約 500 人");
    expect(
      popularity.facts.find((f) => f.label === "視聴者 1000 人以上")?.value,
    ).toBe("1 件");
    expect(
      popularity.facts.find((f) => f.label === "視聴者 100 人未満")?.value,
    ).toBe("1 件");
    // ニッチ側（視聴者が少ない順）を根拠に出す。
    expect(popularity.evidenceWorks[0]?.annictWorkId).toBe(3);
  });

  it("データが無い項目は省略し、根拠作品は履歴に実在する作品だけにする", () => {
    const drafts = buildSectionDrafts([
      row({ annictWorkId: 1, state: "WANNA_WATCH" }),
    ]);
    const keys = drafts.map((d) => d.key);
    // ジャンル・時期・人気度は視聴開始済みが無いため出ない。
    expect(keys).not.toContain("genres");
    expect(keys).not.toContain("seasons");
    expect(keys).not.toContain("popularity");
    expect(keys).toContain("completion");
    for (const d of drafts) {
      for (const w of d.evidenceWorks) {
        expect(w.annictWorkId).toBe(1);
      }
    }
  });
});

describe("attachInsights", () => {
  const drafts = buildSectionDrafts([
    row({ annictWorkId: 1, genres: ["Action"], seasonYear: 2024 }),
  ]);

  it("AI の解釈文を各セクションに載せる", () => {
    const sections = attachInsights(
      drafts,
      { genres: "アクション中心です" },
      160,
    );
    const genres = sections.find((s) => s.key === "genres")!;
    expect(genres.insight).toBe("アクション中心です");
  });

  it("AI が解釈文を返さなかった項目は集計値の事実文にフォールバックする", () => {
    const sections = attachInsights(drafts, {}, 160);
    for (const s of sections) {
      expect(s.insight.length).toBeGreaterThan(0);
      expect(s.insight).toBe(
        drafts.find((d) => d.key === s.key)!.fallbackInsight,
      );
    }
  });

  it("空文字の解釈文はフォールバックに倒し、長すぎる解釈文は切り詰める", () => {
    const sections = attachInsights(
      drafts,
      { genres: "   ", seasons: "あ".repeat(200) },
      160,
    );
    expect(sections.find((s) => s.key === "genres")!.insight).toBe(
      drafts.find((d) => d.key === "genres")!.fallbackInsight,
    );
    expect(sections.find((s) => s.key === "seasons")!.insight).toHaveLength(
      160,
    );
  });
});
