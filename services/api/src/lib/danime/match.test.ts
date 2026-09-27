import { describe, it, expect, vi } from "vitest";
import { classifyWork, matchDanimeWorks } from "@/lib/danime/match";
import type { AnnictLibraryEntry } from "@/lib/annict/client";

function work(partial: Partial<AnnictLibraryEntry> & { annictId: number }) {
  return {
    annictWorkId: partial.annictId,
    nodeId: `Work-${partial.annictId}`,
    state: null,
    title: partial.title ?? `作品${partial.annictId}`,
    titleKana: partial.titleKana ?? null,
    titleEn: partial.titleEn ?? null,
    seasonName: null,
    seasonYear: null,
    imageUrl: null,
    malAnimeId: null,
  } satisfies AnnictLibraryEntry;
}

const INPUT = {
  danimeWorkId: "25001",
  title: "鬼滅の刃 竈門炭治郎 立志編",
  targetState: "WATCHED" as const,
};

describe("classifyWork", () => {
  it("正規化完全一致が 1 件だけなら exact", () => {
    const result = classifyWork(INPUT, [
      work({ annictId: 1, title: "鬼滅の刃 竈門炭治郎 立志編" }),
      work({ annictId: 2, title: "鬼滅の刃 遊郭編" }),
    ]);
    expect(result.status).toBe("exact");
    expect(result.work?.annictWorkId).toBe(1);
    expect(result.candidates).toEqual([]);
  });

  it("完全一致が複数ある場合は candidates に落とす（誤確定を防ぐ）", () => {
    const result = classifyWork(INPUT, [
      work({ annictId: 1, title: "鬼滅の刃 竈門炭治郎 立志編" }),
      work({ annictId: 2, title: "鬼滅の刃　竈門炭治郎　立志編" }),
    ]);
    expect(result.status).toBe("candidates");
    expect(result.work).toBeNull();
    expect(result.candidates.map((c) => c.annictWorkId)).toEqual([1, 2]);
  });

  it("部分一致だけなら candidates（スコア降順）", () => {
    const result = classifyWork(INPUT, [
      work({ annictId: 1, title: "鬼滅の刃" }),
      work({ annictId: 2, title: "鬼滅の刃 竈門炭治郎 立志編 特別編集版" }),
      work({ annictId: 3, title: "呪術廻戦" }),
    ]);
    expect(result.status).toBe("candidates");
    // より近い（長い方の包含）候補が先頭
    expect(result.candidates[0].annictWorkId).toBe(2);
    expect(result.candidates.map((c) => c.annictWorkId)).not.toContain(3);
  });

  it("候補ゼロなら none", () => {
    const result = classifyWork(INPUT, [
      work({ annictId: 9, title: "呪術廻戦" }),
    ]);
    expect(result.status).toBe("none");
  });

  it("titleKana / titleEn もスコアリング対象にする", () => {
    const result = classifyWork({ ...INPUT, title: "kimetsu no yaiba" }, [
      work({ annictId: 1, title: "鬼滅の刃", titleEn: "Kimetsu no Yaiba" }),
    ]);
    expect(result.status).toBe("candidates");
  });
});

// matchDanimeWorks 用に Annict GraphQL の searchWorks 応答をモックする。
function mockAnnictSearch(handler: (titles: string[]) => AnnictLibraryEntry[]) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (_input, init) => {
      const body = JSON.parse((init?.body as string) ?? "{}");
      const titles: string[] = body.variables?.titles ?? [];
      const nodes = handler(titles).map((w) => ({
        id: w.nodeId,
        annictId: w.annictWorkId,
        malAnimeId: w.malAnimeId,
        title: w.title,
        titleKana: w.titleKana,
        titleEn: w.titleEn,
        seasonName: w.seasonName,
        seasonYear: w.seasonYear,
        image: { recommendedImageUrl: w.imageUrl },
      }));
      return new Response(
        JSON.stringify({
          data: {
            searchWorks: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes,
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });
}

describe("matchDanimeWorks", () => {
  it("バッチ検索の結果を各入力へ帰属し、入力順を維持して返す", async () => {
    const spy = mockAnnictSearch((titles) =>
      titles.flatMap((t) =>
        t === "鬼滅の刃"
          ? [work({ annictId: 1, title: "鬼滅の刃" })]
          : t === "呪術廻戦"
            ? [work({ annictId: 2, title: "呪術廻戦" })]
            : [],
      ),
    );
    const items = [
      { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" as const },
      {
        danimeWorkId: "2",
        title: "呪術廻戦",
        targetState: "WATCHING" as const,
      },
      {
        danimeWorkId: "3",
        title: "存在しない作品",
        targetState: "WATCHED" as const,
      },
    ];

    const results = await matchDanimeWorks("tok", items);
    expect(results).toHaveLength(3);
    expect(results[0].status).toBe("exact");
    expect(results[1].status).toBe("exact");
    expect(results[2].status).toBe("none");
    // 第 1 パスは 1 クエリにまとまる（10 件以下）
    const firstCall = JSON.parse(
      (spy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(firstCall.variables.titles).toHaveLength(3);
    spy.mockRestore();
  });

  it("union で取りこぼした作品は単発再検索で拾う", async () => {
    const spy = mockAnnictSearch((titles) =>
      // バッチ呼び出しでは空振り、単発（titles.length===1）ではヒット、
      // という挙動を真似て union 打ち切りの救済を検証する。
      titles.length === 1 && titles[0] === "レア作品"
        ? [work({ annictId: 7, title: "レア作品" })]
        : [],
    );
    const results = await matchDanimeWorks("tok", [
      { danimeWorkId: "9", title: "レア作品", targetState: "WATCHED" },
    ]);
    expect(results[0].status).toBe("exact");
    expect(results[0].work?.annictWorkId).toBe(7);
    spy.mockRestore();
  });

  it("元タイトルの再検索が無関係な候補しか返さない場合は単純化タイトルも試す", async () => {
    const spy = mockAnnictSearch((titles) => {
      if (titles.length !== 1) return []; // 第 1 パス（バッチ）は空振り
      if (titles[0] === "作品A (2024)") {
        // 元タイトルの部分一致で無関係な作品だけ返る → classify は none
        return [work({ annictId: 8, title: "全く別の作品" })];
      }
      if (titles[0] === "作品A") {
        return [work({ annictId: 9, title: "作品A" })];
      }
      return [];
    });
    const results = await matchDanimeWorks("tok", [
      { danimeWorkId: "5", title: "作品A (2024)", targetState: "WATCHED" },
    ]);
    expect(results[0].status).toBe("exact");
    expect(results[0].work?.annictWorkId).toBe(9);
    spy.mockRestore();
  });

  it("同一 danimeWorkId の重複は潰して同じ結果を返す", async () => {
    const spy = mockAnnictSearch(() => [
      work({ annictId: 1, title: "鬼滅の刃" }),
    ]);
    const results = await matchDanimeWorks("tok", [
      { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
      { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(results[1]);
    spy.mockRestore();
  });
});
