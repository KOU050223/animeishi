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
    // 「特別編集版」は本編と別エディションのメタ差分として減点され、
    // ベースタイトル一致の候補が先頭になる
    expect(result.candidates[0].annictWorkId).toBe(1);
    expect(result.candidates.map((c) => c.annictWorkId)).toEqual([1, 2]);
  });

  it("劇場版の入力では劇場版エントリが TV 版より上位になる", () => {
    const result = classifyWork({ ...INPUT, title: "劇場版 SHIROBAKO" }, [
      work({ annictId: 1, title: "SHIROBAKO" }),
      work({ annictId: 2, title: "劇場版 SHIROBAKO" }),
    ]);
    expect(result.status).toBe("exact");
    expect(result.work?.annictWorkId).toBe(2);
  });

  it("登録済みの別シーズンは、入力が期数を明示しているとき候補から除外する", () => {
    const pool = [
      work({ annictId: 1, title: "響け！ユーフォニアム" }),
      work({ annictId: 2, title: "響け！ユーフォニアム2" }),
    ];
    const input = { ...INPUT, title: "響け！ユーフォニアム2" };
    // 無印（期数不明）の 1期は「別シーズンと確定」できないため候補に残るが、
    // 正規化一致した 2期（id=2）が exact になる。
    const result = classifyWork(input, pool, {
      registeredWorkIds: new Set([1]),
    });
    expect(result.status).toBe("exact");
    expect(result.work?.annictWorkId).toBe(2);
  });

  it("登録済みでも候補側の期数が不明なら候補から除外しない", () => {
    // 入力が第2期を明示していても、無印（期数不明）の登録済み候補は
    // 別シーズンと確定できないため残す。期数ガードにより exact にはならない。
    const result = classifyWork(
      { ...INPUT, title: "響け！ユーフォニアム 2期" },
      [work({ annictId: 1, title: "響け！ユーフォニアム" })],
      { registeredWorkIds: new Set([1]) },
    );
    expect(result.status).toBe("candidates");
    expect(result.candidates[0].annictWorkId).toBe(1);
  });

  it("登録済みでも入力が期数を持たなければ除外しない", () => {
    const result = classifyWork(
      { ...INPUT, title: "響け！ユーフォニアム" },
      [
        work({ annictId: 1, title: "響け！ユーフォニアム" }),
        work({ annictId: 2, title: "響け！ユーフォニアム2" }),
      ],
      { registeredWorkIds: new Set([1]) },
    );
    // 1期は登録済みでも正規化一致するため exact のまま
    expect(result.status).toBe("exact");
    expect(result.work?.annictWorkId).toBe(1);
  });

  it("検索語に期数がなくても、元入力の期数で exact 判定をガードする", () => {
    // 「MFゴースト 2nd Season」の単純化検索語「MFゴースト」で第1期だけが
    // 見つかったケース。検索語と正規化一致するが、元入力が第2期なので
    // 別シーズンを自動確定できず candidates に落とす。
    const result = classifyWork(
      { ...INPUT, title: "MFゴースト" },
      [work({ annictId: 1, title: "MFゴースト" })],
      { seasonRefTitle: "MFゴースト 2nd Season" },
    );
    expect(result.status).toBe("candidates");
    expect(result.work).toBeNull();
    expect(result.candidates[0].annictWorkId).toBe(1);
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

  it("TVアニメ「X」形式のタイトルは冠を外して検索・照合する", async () => {
    const spy = mockAnnictSearch((titles) =>
      titles.flatMap((t) =>
        t === "てっぺんっ!!!"
          ? [work({ annictId: 1, title: "てっぺんっ!!!" })]
          : [],
      ),
    );
    const results = await matchDanimeWorks("tok", [
      {
        danimeWorkId: "1",
        title: "TVアニメ「てっぺんっ!!!」",
        targetState: "WATCHED",
      },
    ]);
    expect(results[0].status).toBe("exact");
    expect(results[0].work?.annictWorkId).toBe(1);
    // レビュー画面には元タイトルを返す
    expect(results[0].title).toBe("TVアニメ「てっぺんっ!!!」");
    // 冠つきのまま・冠だけの退化クエリは Annict に送らない
    const sent = spy.mock.calls.flatMap((c) => {
      const body = JSON.parse((c[1] as RequestInit).body as string);
      return body.variables?.titles ?? [];
    });
    expect(sent).not.toContain("TVアニメ");
    expect(sent).not.toContain("TVアニメ「てっぺんっ!!!」");
    spy.mockRestore();
  });

  it("劇場版「X」形式は冠を残してアンラップする（劇場版エントリに届く）", async () => {
    const spy = mockAnnictSearch((titles) =>
      titles.flatMap((t) =>
        t === "劇場版 SHIROBAKO"
          ? [
              work({ annictId: 1, title: "SHIROBAKO" }),
              work({ annictId: 2, title: "劇場版 SHIROBAKO" }),
            ]
          : [],
      ),
    );
    const results = await matchDanimeWorks("tok", [
      {
        danimeWorkId: "1",
        title: "劇場版「SHIROBAKO」",
        targetState: "WATCHED",
      },
    ]);
    expect(results[0].status).toBe("exact");
    expect(results[0].work?.annictWorkId).toBe(2);
    spy.mockRestore();
  });

  it("一般名詞だけの退化タイトルは Annict を叩かず none にする", async () => {
    const spy = mockAnnictSearch(() => [
      work({ annictId: 1, title: "炬燵猫（TVアニメ）" }),
    ]);
    const results = await matchDanimeWorks("tok", [
      { danimeWorkId: "1", title: "TVアニメ", targetState: "WATCHED" },
    ]);
    expect(results[0].status).toBe("none");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("全角数字のタイトルは半角バリアントの検索で拾う", async () => {
    const spy = mockAnnictSearch((titles) =>
      titles.flatMap((t) =>
        // Annict 側は半角「3」表記で、dアニメ側は全角「３」
        t === "響け！ユーフォニアム3"
          ? [work({ annictId: 3, title: "響け！ユーフォニアム3" })]
          : [],
      ),
    );
    const results = await matchDanimeWorks("tok", [
      {
        danimeWorkId: "1",
        title: "響け！ユーフォニアム３",
        targetState: "WATCHED",
      },
    ]);
    expect(results[0].status).toBe("exact");
    expect(results[0].work?.annictWorkId).toBe(3);
    spy.mockRestore();
  });

  it("無印が先に候補に残っても全半角バリアントの再検索で本来の作品を拾う", async () => {
    const spy = mockAnnictSearch((titles) =>
      titles.flatMap((t) =>
        t === "響け！ユーフォニアム"
          ? [work({ annictId: 1, title: "響け！ユーフォニアム" })]
          : t === "響け！ユーフォニアム3"
            ? [work({ annictId: 3, title: "響け！ユーフォニアム3" })]
            : [],
      ),
    );
    // 同じバッチの「響け！ユーフォニアム」の union 検索で無印（id=1）が返り、
    // 「響け！ユーフォニアム３」はそれが候補に残るため none にならない。
    // candidates でも全半角バリアントを再検索し、3期（id=3）を拾う。
    const results = await matchDanimeWorks("tok", [
      {
        danimeWorkId: "1",
        title: "響け！ユーフォニアム",
        targetState: "WATCHED",
      },
      {
        danimeWorkId: "2",
        title: "響け！ユーフォニアム３",
        targetState: "WATCHED",
      },
    ]);
    expect(results[0].status).toBe("exact");
    expect(results[0].work?.annictWorkId).toBe(1);
    expect(results[1].status).toBe("exact");
    expect(results[1].work?.annictWorkId).toBe(3);
    spy.mockRestore();
  });

  it("単純化再検索で別シーズンが見つかっても自動確定しない", async () => {
    const spy = mockAnnictSearch((titles) =>
      titles.flatMap((t) =>
        // 第2期は Annict に無く、単純化検索語で第1期（無印）だけが返る
        t === "MFゴースト" ? [work({ annictId: 1, title: "MFゴースト" })] : [],
      ),
    );
    const results = await matchDanimeWorks("tok", [
      {
        danimeWorkId: "1",
        title: "MFゴースト 2nd Season",
        targetState: "WATCHED",
      },
    ]);
    // 検索語とは正規化一致するが入力が第2期なので exact にせず
    // レビューへ回す（第1期への誤登録を防ぐ）
    expect(results[0].status).toBe("candidates");
    expect(results[0].work).toBeNull();
    expect(results[0].candidates[0].annictWorkId).toBe(1);
    spy.mockRestore();
  });

  it("映画冠の入力は劇場版表記の作品を冠バリアントの再検索で拾う", async () => {
    const spy = mockAnnictSearch((titles) =>
      titles.flatMap((t) =>
        // Annict 側は「劇場版」表記、dアニメ側は「映画」冠
        t === "劇場版 すずめの戸締まり"
          ? [work({ annictId: 4, title: "劇場版 すずめの戸締まり" })]
          : [],
      ),
    );
    const results = await matchDanimeWorks("tok", [
      {
        danimeWorkId: "1",
        title: "映画「すずめの戸締まり」",
        targetState: "WATCHED",
      },
    ]);
    expect(results[0].status).toBe("exact");
    expect(results[0].work?.annictWorkId).toBe(4);
    spy.mockRestore();
  });
});
