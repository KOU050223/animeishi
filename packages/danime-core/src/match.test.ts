import { describe, expect, it, vi } from "vitest";
import type { AnnictSearcher } from "./match";
import { classifyWork, matchDanimeWorks } from "./match";
import type { DanimeAnnictWork } from "./types";

function work(
  partial: Partial<DanimeAnnictWork> & { annictId: number },
): DanimeAnnictWork {
  return {
    annictWorkId: partial.annictId,
    nodeId: `Work-${partial.annictId}`,
    title: partial.title ?? `作品${partial.annictId}`,
    titleKana: partial.titleKana ?? null,
    titleEn: partial.titleEn ?? null,
    seasonName: null,
    seasonYear: null,
    imageUrl: null,
    malAnimeId: null,
  };
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
    expect(result.candidates[0]?.annictWorkId).toBe(1);
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
    expect(result.candidates[0]?.annictWorkId).toBe(1);
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
    expect(result.candidates[0]?.annictWorkId).toBe(1);
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

// matchDanimeWorks に注入する AnnictSearcher のスタブ。
// handler はタイトル群ごとに返す作品を決める。呼ばれた検索語は
// searcher.mock.calls[*][0] で検証できる。
// delayMs / inflight を渡すと、並列実行の検証に使えるよう応答を
// 遅らせつつ同時実行数を記録する。
function mockSearcher(
  handler: (titles: string[]) => DanimeAnnictWork[],
  opts: { delayMs?: number; inflight?: { current: number; max: number } } = {},
): AnnictSearcher & ReturnType<typeof vi.fn> {
  return vi.fn(async (titles: string[]) => {
    if (opts.inflight) {
      opts.inflight.current++;
      opts.inflight.max = Math.max(opts.inflight.max, opts.inflight.current);
    }
    try {
      if (opts.delayMs) {
        await new Promise((r) => setTimeout(r, opts.delayMs));
      }
      return handler(titles);
    } finally {
      if (opts.inflight) opts.inflight.current--;
    }
  });
}

describe("matchDanimeWorks", () => {
  it("バッチ検索の結果を各入力へ帰属し、入力順を維持して返す", async () => {
    const searcher = mockSearcher((titles) =>
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

    const { results } = await matchDanimeWorks(searcher, items);
    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe("exact");
    expect(results[1]?.status).toBe("exact");
    expect(results[2]?.status).toBe("none");
    // 第 1 パスは 1 クエリにまとまる（10 件以下）
    expect(searcher.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it("union で取りこぼした作品は単発再検索で拾う", async () => {
    const searcher = mockSearcher((titles) =>
      // バッチ呼び出しでは空振り、単発（titles.length===1）ではヒット、
      // という挙動を真似て union 打ち切りの救済を検証する。
      titles.length === 1 && titles[0] === "レア作品"
        ? [work({ annictId: 7, title: "レア作品" })]
        : [],
    );
    const { results } = await matchDanimeWorks(searcher, [
      { danimeWorkId: "9", title: "レア作品", targetState: "WATCHED" },
    ]);
    expect(results[0]?.status).toBe("exact");
    expect(results[0]?.work?.annictWorkId).toBe(7);
  });

  it("元タイトルの再検索が無関係な候補しか返さない場合は単純化タイトルも試す", async () => {
    const searcher = mockSearcher((titles) => {
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
    const { results } = await matchDanimeWorks(searcher, [
      { danimeWorkId: "5", title: "作品A (2024)", targetState: "WATCHED" },
    ]);
    expect(results[0]?.status).toBe("exact");
    expect(results[0]?.work?.annictWorkId).toBe(9);
  });

  it("同一 danimeWorkId の重複は潰して同じ結果を返す", async () => {
    const searcher = mockSearcher(() => [
      work({ annictId: 1, title: "鬼滅の刃" }),
    ]);
    const { results } = await matchDanimeWorks(searcher, [
      { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
      { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(results[1]);
  });

  it("TVアニメ「X」形式のタイトルは冠を外して検索・照合する", async () => {
    const searcher = mockSearcher((titles) =>
      titles.flatMap((t) =>
        t === "てっぺんっ!!!"
          ? [work({ annictId: 1, title: "てっぺんっ!!!" })]
          : [],
      ),
    );
    const { results } = await matchDanimeWorks(searcher, [
      {
        danimeWorkId: "1",
        title: "TVアニメ「てっぺんっ!!!」",
        targetState: "WATCHED",
      },
    ]);
    expect(results[0]?.status).toBe("exact");
    expect(results[0]?.work?.annictWorkId).toBe(1);
    // レビュー画面には元タイトルを返す
    expect(results[0]?.title).toBe("TVアニメ「てっぺんっ!!!」");
    // 冠つきのまま・冠だけの退化クエリは Annict に送らない
    const sent = searcher.mock.calls.flatMap((c) => c[0]);
    expect(sent).not.toContain("TVアニメ");
    expect(sent).not.toContain("TVアニメ「てっぺんっ!!!」");
  });

  it("劇場版「X」形式は冠を残してアンラップする（劇場版エントリに届く）", async () => {
    const searcher = mockSearcher((titles) =>
      titles.flatMap((t) =>
        t === "劇場版 SHIROBAKO"
          ? [
              work({ annictId: 1, title: "SHIROBAKO" }),
              work({ annictId: 2, title: "劇場版 SHIROBAKO" }),
            ]
          : [],
      ),
    );
    const { results } = await matchDanimeWorks(searcher, [
      {
        danimeWorkId: "1",
        title: "劇場版「SHIROBAKO」",
        targetState: "WATCHED",
      },
    ]);
    expect(results[0]?.status).toBe("exact");
    expect(results[0]?.work?.annictWorkId).toBe(2);
  });

  it("一般名詞だけの退化タイトルは Annict を叩かず none にする", async () => {
    const searcher = mockSearcher(() => [
      work({ annictId: 1, title: "炬燵猫（TVアニメ）" }),
    ]);
    const { results } = await matchDanimeWorks(searcher, [
      { danimeWorkId: "1", title: "TVアニメ", targetState: "WATCHED" },
    ]);
    expect(results[0]?.status).toBe("none");
    expect(searcher).not.toHaveBeenCalled();
  });

  it("全角数字のタイトルは半角バリアントの検索で拾う", async () => {
    const searcher = mockSearcher((titles) =>
      titles.flatMap((t) =>
        // Annict 側は半角「3」表記で、dアニメ側は全角「３」
        t === "響け！ユーフォニアム3"
          ? [work({ annictId: 3, title: "響け！ユーフォニアム3" })]
          : [],
      ),
    );
    const { results } = await matchDanimeWorks(searcher, [
      {
        danimeWorkId: "1",
        title: "響け！ユーフォニアム３",
        targetState: "WATCHED",
      },
    ]);
    expect(results[0]?.status).toBe("exact");
    expect(results[0]?.work?.annictWorkId).toBe(3);
  });

  it("無印が先に候補に残っても全半角バリアントの再検索で本来の作品を拾う", async () => {
    const searcher = mockSearcher((titles) =>
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
    const { results } = await matchDanimeWorks(searcher, [
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
    expect(results[0]?.status).toBe("exact");
    expect(results[0]?.work?.annictWorkId).toBe(1);
    expect(results[1]?.status).toBe("exact");
    expect(results[1]?.work?.annictWorkId).toBe(3);
  });

  it("単純化再検索で別シーズンが見つかっても自動確定しない", async () => {
    const searcher = mockSearcher((titles) =>
      titles.flatMap((t) =>
        // 第2期は Annict に無く、単純化検索語で第1期（無印）だけが返る
        t === "MFゴースト" ? [work({ annictId: 1, title: "MFゴースト" })] : [],
      ),
    );
    const { results } = await matchDanimeWorks(searcher, [
      {
        danimeWorkId: "1",
        title: "MFゴースト 2nd Season",
        targetState: "WATCHED",
      },
    ]);
    // 検索語とは正規化一致するが入力が第2期なので exact にせず
    // レビューへ回す（第1期への誤登録を防ぐ）
    expect(results[0]?.status).toBe("candidates");
    expect(results[0]?.work).toBeNull();
    expect(results[0]?.candidates[0]?.annictWorkId).toBe(1);
  });

  it("映画冠の入力は劇場版表記の作品を冠バリアントの再検索で拾う", async () => {
    const searcher = mockSearcher((titles) =>
      titles.flatMap((t) =>
        // Annict 側は「劇場版」表記、dアニメ側は「映画」冠
        t === "劇場版 すずめの戸締まり"
          ? [work({ annictId: 4, title: "劇場版 すずめの戸締まり" })]
          : [],
      ),
    );
    const { results } = await matchDanimeWorks(searcher, [
      {
        danimeWorkId: "1",
        title: "映画「すずめの戸締まり」",
        targetState: "WATCHED",
      },
    ]);
    expect(results[0]?.status).toBe("exact");
    expect(results[0]?.work?.annictWorkId).toBe(4);
  });

  it("第 1 パスの union 検索は複数チャンクを並列に実行する", async () => {
    const inflight = { current: 0, max: 0 };
    const searcher = mockSearcher(
      (titles) =>
        titles.map((t) => {
          const id = Number(t.replace("作品", ""));
          return work({ annictId: id, title: t });
        }),
      { delayMs: 15, inflight },
    );
    // 20 件 → 10 件ずつ 2 チャンク。並列なら同時実行が 2 に達する。
    const items = Array.from({ length: 20 }, (_, i) => ({
      danimeWorkId: String(i),
      title: `作品${i}`,
      targetState: "WATCHED" as const,
    }));
    const { results, stats } = await matchDanimeWorks(searcher, items);
    expect(inflight.max).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.status === "exact")).toBe(true);
    expect(stats.firstPassSearches).toBe(2);
  });

  it("第 2 パスの未解決タイトル再検索も並列に実行する", async () => {
    const inflight = { current: 0, max: 0 };
    const searcher = mockSearcher(() => [], { delayMs: 10, inflight });
    // 6 件とも全パスで見つからず、それぞれ複数クエリを逐次試す。
    const items = Array.from({ length: 6 }, (_, i) => ({
      danimeWorkId: String(i),
      title: `ない作品${i}`,
      targetState: "WATCHED" as const,
    }));
    const { results, stats } = await matchDanimeWorks(searcher, items);
    expect(inflight.max).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.status === "none")).toBe(true);
    expect(stats.secondPassSearches).toBeGreaterThan(0);
  });

  it("第 2 パスの検索回数は全体上限を超えない", async () => {
    const searcher = mockSearcher(() => []);
    // 未解決 60 件 × 複数クエリでも、上限（50）までしか検索しない。
    const items = Array.from({ length: 60 }, (_, i) => ({
      danimeWorkId: String(i),
      title: `ない作品${i}`,
      targetState: "WATCHED" as const,
    }));
    const { stats } = await matchDanimeWorks(searcher, items);
    expect(stats.secondPassSearches).toBe(50);
    // 第 1 パス（union）は 10 件チャンク × 6 回。
    expect(stats.firstPassSearches).toBe(6);
    // 単発再検索（titles 1 件の呼び出し）がちょうど 50 回。
    const singleTitleCalls = searcher.mock.calls.filter(
      (c) => c[0].length === 1,
    );
    expect(singleTitleCalls).toHaveLength(50);
  });

  it("先頭の未解決タイトルが遅くても、後続タスクに上限枠を先食いされない", async () => {
    // レビュー指摘: 全未解決タイトルを一括で並列化すると、先頭タイトルの
    // 検索が遅い間に後続タスクが共有上限（50）を使い切り、先頭タイトルの
    // 残り検索語が試されず未マッチになる。ウェーブ（同時実行数ぶん）ずつ
    // 進めることで、先のタスクが自分の検索語を試し終わるまで後続を
    // 開始しないことを検証する。
    const searcher = vi.fn(async (titles: string[]) => {
      // 先頭タイトルの再検索だけ遅くして、後続タスクの先走りを誘発する。
      // （第 1 パスの union も遅くなるが影響は同じ方向なので許容）
      if (titles.some((t) => t.startsWith("レア作品"))) {
        await new Promise((r) => setTimeout(r, 30));
      }
      // 「レア作品 (限定版)」の検索語列は [元タイトル, 単純化タイトル]。
      // 単純化後の「レア作品」だけがヒットする。
      if (titles.length === 1 && titles[0] === "レア作品") {
        return [work({ annictId: 7, title: "レア作品" })];
      }
      return [] as DanimeAnnictWork[];
    });
    // 先頭の遅いタイトル + 共有上限を食い尽くせるだけの後続タイトル。
    const items = [
      {
        danimeWorkId: "0",
        title: "レア作品 (限定版)",
        targetState: "WATCHED" as const,
      },
      ...Array.from({ length: 59 }, (_, i) => ({
        danimeWorkId: String(i + 1),
        title: `ない作品${i}`,
        targetState: "WATCHED" as const,
      })),
    ];
    const { results, stats } = await matchDanimeWorks(searcher, items);
    // 先頭タイトルは単純化クエリまで到達して確定できる。
    expect(results[0]?.status).toBe("exact");
    expect(results[0]?.work?.annictWorkId).toBe(7);
    // 共有上限は変わらず 50 往復に収まる。
    expect(stats.secondPassSearches).toBe(50);
  });

  it("大規模入力でもスコアリングの CPU 時間が頭打ちになる（issue #219）", async () => {
    // 旧実装は「入力 × 候補」の全ペアで正規化・メタ抽出をやり直していたため
    // この条件で ~30s の CPU を消費し、本番 Workers の CPU 時間上限超過
    // （Error 1102 → 503・CORS ヘッダなし）に達していた。シグネチャの
    // 前計算で入力・候補それぞれ 1 回ずつの計算に抑える回帰テスト。
    // searcher は即時応答させ、純粋な計算時間だけを測る。
    let nextId = 0;
    const searcher = mockSearcher(() =>
      // Annict の first:50 打ち切りいっぱい（1 クエリ 50 件）を返す最悪ケース。
      // 500 件入力 → union 50 回 × 50 件 = 最大 2500 件の候補プール。
      Array.from({ length: 50 }, () =>
        work({ annictId: nextId++, title: "似た名前の作品" }),
      ),
    );
    const items = Array.from({ length: 500 }, (_, i) => ({
      danimeWorkId: `w${i}`,
      title: `テスト作品その${i}`,
      targetState: "WATCHED" as const,
    }));
    const startedAt = performance.now();
    const { results } = await matchDanimeWorks(searcher, items);
    const elapsedMs = performance.now() - startedAt;
    expect(results).toHaveLength(500);
    // 旧実装 ~30s との識別に十分な余裕を持つ上限。CI マシンのばらつきを
    // 考慮しても十分小さい値（現行実装の実測は数百ms）。
    expect(elapsedMs).toBeLessThan(15_000);
  }, 30_000);

  // 呼び出し側（API）が失敗時の構造化ログに検索段階を載せられるよう、
  // searcher の第 2 引数に phase を渡す。
  it("searcher には検索段階（firstPass/secondPass）を渡す", async () => {
    const searcher = mockSearcher(() => []);
    await matchDanimeWorks(searcher, [
      { danimeWorkId: "1", title: "ない作品", targetState: "WATCHED" },
    ]);
    expect(searcher.mock.calls[0]?.[1]).toEqual({ phase: "firstPass" });
    const secondPassCalls = searcher.mock.calls.filter(
      (c) => c[1]?.phase === "secondPass",
    );
    expect(secondPassCalls.length).toBeGreaterThan(0);
    expect(secondPassCalls.every((c) => c[0].length === 1)).toBe(true);
  });

  it("検索回数・経過時間を stats で返す", async () => {
    const searcher = mockSearcher((titles) =>
      titles.flatMap((t) =>
        t === "鬼滅の刃" ? [work({ annictId: 1, title: "鬼滅の刃" })] : [],
      ),
    );
    const { results, stats } = await matchDanimeWorks(searcher, [
      { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
      { danimeWorkId: "2", title: "ない作品", targetState: "WATCHED" },
    ]);
    expect(results[0]?.status).toBe("exact");
    expect(stats.firstPassSearches).toBe(1);
    expect(stats.secondPassSearches).toBeGreaterThan(0);
    expect(stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});

// issue #219: Workers のサブリクエスト上限に触れないよう、呼び出し側
// （API の予算付き searcher / D1 キャッシュ検索）が「検索しなかった」を
// null で返し、core が未検索分を pending として呼び出し側の再送に回す
// 契約を検証する。
describe("matchDanimeWorks: pending とローカル検索（issue #219）", () => {
  it("searcher が検索をスキップ（null）したチャンクの入力は pending になる", async () => {
    // 未検索のまま none にすると「Annict に存在しない」という誤った
    // 確定を返すため、pending として呼び出し側の再送に回す。
    const searcher = vi.fn(async () => null);
    const { results, stats } = await matchDanimeWorks(searcher, [
      { danimeWorkId: "1", title: "作品A", targetState: "WATCHED" },
      { danimeWorkId: "2", title: "作品B", targetState: "WATCHED" },
    ]);
    expect(results.map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(stats.pending).toBe(2);
    // 一度スキップされたら残りの検索計画も打ち切る（予算は戻らない）
    expect(searcher.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("スキップされなかったチャンクは通常どおり照合し、スキップ分だけ pending にする", async () => {
    // 10 件ずつの 2 チャンク。後半チャンクだけ searcher がスキップする。
    const searcher = vi.fn(async (titles: string[]) =>
      titles.some((t) => t.includes("保留"))
        ? null
        : titles.map((t, i) => work({ annictId: i + 1, title: t })),
    );
    const items = [
      ...Array.from({ length: 10 }, (_, i) => ({
        danimeWorkId: String(i),
        title: `確定作品${i}`,
        targetState: "WATCHED" as const,
      })),
      ...Array.from({ length: 10 }, (_, i) => ({
        danimeWorkId: String(i + 10),
        title: `保留作品${i}`,
        targetState: "WATCHED" as const,
      })),
    ];
    const { results, stats } = await matchDanimeWorks(searcher, items);
    expect(results.slice(0, 10).every((r) => r.status === "exact")).toBe(true);
    expect(results.slice(10).every((r) => r.status === "pending")).toBe(true);
    expect(stats.pending).toBe(10);
  });

  it("再検索回数の上限に達して残った未解決入力は pending になる", async () => {
    const searcher = mockSearcher(() => []);
    // 未解決 60 件。第 2 パス上限（50 往復）では全件の再検索を
    // 完走できないため、途中から pending になる。
    const items = Array.from({ length: 60 }, (_, i) => ({
      danimeWorkId: String(i),
      title: `ない作品${i}`,
      targetState: "WATCHED" as const,
    }));
    const { results, stats } = await matchDanimeWorks(searcher, items);
    expect(stats.secondPassSearches).toBe(50);
    expect(results.some((r) => r.status === "pending")).toBe(true);
    expect(stats.pending).toBe(
      results.filter((r) => r.status === "pending").length,
    );
  });

  it("localSearch で exact に確定したタイトルは Annict searcher に送らない", async () => {
    const localSearch = vi.fn(async (titles: string[]) =>
      titles.flatMap((t) =>
        t === "鬼滅の刃" ? [work({ annictId: 1, title: "鬼滅の刃" })] : [],
      ),
    );
    const searcher = mockSearcher((titles) =>
      titles.flatMap((t) =>
        t === "呪術廻戦" ? [work({ annictId: 2, title: "呪術廻戦" })] : [],
      ),
    );
    const { results, stats } = await matchDanimeWorks(
      searcher,
      [
        { danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" },
        { danimeWorkId: "2", title: "呪術廻戦", targetState: "WATCHED" },
      ],
      undefined,
      { localSearch },
    );
    expect(results[0]?.status).toBe("exact");
    expect(results[0]?.work?.annictWorkId).toBe(1);
    expect(results[1]?.status).toBe("exact");
    // D1 側で確定したタイトルは Annict の検索語に含まれない
    const sentToAnnict = searcher.mock.calls.flatMap((c) => c[0]);
    expect(sentToAnnict).not.toContain("鬼滅の刃");
    expect(stats.localPassSearches).toBe(1);
  });

  it("localSearch の候補は Annict 側の候補プールに合流する", async () => {
    // ローカルで部分一致しかないタイトルは Annict に検索され、
    // ローカルの候補も最終の候補プールに残る。
    const localSearch = vi.fn(async (titles: string[]) =>
      titles.flatMap((t) =>
        t === "無職転生" ? [work({ annictId: 3, title: "無職転生Ⅱ" })] : [],
      ),
    );
    const searcher = mockSearcher((titles) =>
      titles.flatMap((t) =>
        t === "無職転生"
          ? [
              work({ annictId: 4, title: "無職転生" }),
              // 正規化一致がもう 1 件ある（同名の別作品）→ 確定できず
              // candidates になる。
              work({ annictId: 5, title: "無職転生　" }),
            ]
          : [],
      ),
    );
    const { results } = await matchDanimeWorks(
      searcher,
      [{ danimeWorkId: "1", title: "無職転生", targetState: "WATCHED" }],
      undefined,
      { localSearch },
    );
    expect(results[0]?.status).toBe("candidates");
    expect(results[0]?.work).toBeNull();
    // Annict 側の 2 件に加え、ローカルの部分一致候補（id=3）も残る
    expect(results[0]?.candidates.map((c) => c.annictWorkId)).toEqual(
      expect.arrayContaining([3, 4, 5]),
    );
    // ローカルで確定できなかったタイトルは Annict に検索される
    const sentToAnnict = searcher.mock.calls.flatMap((c) => c[0]);
    expect(sentToAnnict).toContain("無職転生");
  });

  it("localSearch がスキップ（null）しても Annict 側で照合を続ける", async () => {
    // D1 クエリ自体が予算切れになり得るが、Annict 側に予算が残っていれば
    // そちらで完走できるため、ローカルのスキップは pending にしない。
    const localSearch = vi.fn(async () => null);
    const searcher = mockSearcher((titles) =>
      titles.flatMap((t) =>
        t === "鬼滅の刃" ? [work({ annictId: 1, title: "鬼滅の刃" })] : [],
      ),
    );
    const { results, stats } = await matchDanimeWorks(
      searcher,
      [{ danimeWorkId: "1", title: "鬼滅の刃", targetState: "WATCHED" }],
      undefined,
      { localSearch },
    );
    expect(results[0]?.status).toBe("exact");
    expect(stats.localPassSearches).toBe(0);
    expect(stats.pending).toBe(0);
  });
});
