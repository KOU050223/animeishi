// 話対応付けの純ロジックのテスト。Issue #477 の計測（2026-11-20 コメント）で
// 確認された代表ケースを再現する:
//   - 合併話（「第1話～第4話」）は単一話に確定しない
//   - 話数ずれ・追加話・サブタイトル切れの吸収
//   - B/C が一致するとき A の食い違いより 2 方式一致を優先
//   - 1 方式だけの根拠・方式間の食い違いは確定しない
//   - 同じ Annict 話への重複寄せは後続を確定しない
import { describe, expect, it } from "vitest";
import {
  matchDanimeWorkEpisodes,
  normalizeEpisodeTitle,
  parseDanimeEpisodeNumber,
  type DanimeAnnictEpisode,
  type DanimeEpisodeInput,
} from "./episodeMatch";

// Annict 話一覧のフィクスチャ。sortNumber 順（= A 方式の位置）で作る。
function annictEp(
  i: number,
  opts?: Partial<DanimeAnnictEpisode>,
): DanimeAnnictEpisode {
  return {
    annictEpisodeId: 9000 + i,
    nodeId: `EpNode${i}`,
    number: i,
    numberText: `第${i}話`,
    sortNumber: i * 10,
    title: `タイトル${i}`,
    ...opts,
  };
}

function annictEps(
  n: number,
  opts?: (i: number) => Partial<DanimeAnnictEpisode>,
): DanimeAnnictEpisode[] {
  return Array.from({ length: n }, (_, k) => annictEp(k + 1, opts?.(k + 1)));
}

function danimeEp(
  partId: string,
  label: string,
  subtitle = "",
): DanimeEpisodeInput {
  return { partId, label, subtitle };
}

describe("parseDanimeEpisodeNumber", () => {
  it.each([
    ["第1話", 1],
    ["第12話", 12],
    ["#3", 3],
    ["第十二話", 12],
    ["1日目", 1],
    ["第４話", 4],
  ])("%s → %s", (label, expected) => {
    expect(parseDanimeEpisodeNumber(label).number).toBe(expected);
  });

  it("数字を複数含む表記（合併話）は merged=true で候補にしない", () => {
    expect(parseDanimeEpisodeNumber("第1話～第4話")).toEqual({
      number: null,
      merged: true,
    });
    expect(parseDanimeEpisodeNumber("第1話・第2話").merged).toBe(true);
  });

  it("数字の無い表記は merged=false の null", () => {
    expect(parseDanimeEpisodeNumber("最終話")).toEqual({
      number: null,
      merged: false,
    });
    expect(parseDanimeEpisodeNumber("本編").number).toBeNull();
  });
});

describe("normalizeEpisodeTitle", () => {
  it("記号・空白・大小文字差を潰す", () => {
    expect(normalizeEpisodeTitle("Ｆｉｒｓｔ　Ｓｔｅｐ！")).toBe("firststep");
    expect(normalizeEpisodeTitle("嵐・の・前")).toBe("嵐の前");
  });
});

describe("matchDanimeWorkEpisodes", () => {
  it("A・B・C が同じ話を指す通常ケースは確定する", () => {
    const annict = annictEps(3, (i) => ({ title: `サブ${i}` }));
    const res = matchDanimeWorkEpisodes(
      [
        danimeEp("00001001", "第1話", "サブ1"),
        danimeEp("00001002", "第2話", "サブ2"),
      ],
      annict,
    );
    expect(res.matched).toEqual([
      {
        partId: "00001001",
        annictEpisodeId: annict[0]!.annictEpisodeId,
        episodeNodeId: annict[0]!.nodeId,
      },
      {
        partId: "00001002",
        annictEpisodeId: annict[1]!.annictEpisodeId,
        episodeNodeId: annict[1]!.nodeId,
      },
    ]);
    expect(res.unresolved).toEqual([]);
  });

  it("2 方式以上の一致があれば確定する（A が外れても B+C で確定）", () => {
    // dアニメ側の並びと Annict の sortNumber がずれる作品（OVA 混入等）。
    // partId 末尾 2 番 → A は sortNumber 2 番目を指すが、B と C は
    // 12 話目に一致する → B+C の 2 票で確定。
    const annict = annictEps(12, (i) => ({
      title: i === 12 ? "最終回" : null,
    }));
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00002002", "第12話", "最終回")],
      annict,
    );
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0]!.annictEpisodeId).toBe(annict[11]!.annictEpisodeId);
  });

  it("1 方式だけの根拠は確定しない（no_evidence）", () => {
    // ラベルも数字を持たずサブタイトルも空 → 位置（A）だけの根拠。
    const annict = annictEps(3);
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00001002", "本編", "")],
      annict,
    );
    expect(res.matched).toEqual([]);
    expect(res.unresolved).toEqual([
      { partId: "00001002", reason: "no_evidence" },
    ]);
  });

  it("方式間が食い違う話は確定しない（disagreement）", () => {
    // B（第2話）と C（サブ3）は別々の話を指し、A（位置2）は B と一致。
    // → 2 方式（A+B）で一致するのでこれは確定する。disagreement にするには
    // A の位置も別の話を指す必要がある。
    const annict = annictEps(5, (i) => ({
      title: i === 4 ? "特別編" : `話${i}`,
    }));
    // A: 位置5 → ep5、B: 第2話 → ep2、C: 「特別編」→ ep4。全部バラバラ。
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00005005", "第2話", "特別編")],
      annict,
    );
    expect(res.matched).toEqual([]);
    expect(res.unresolved).toEqual([
      { partId: "00005005", reason: "disagreement" },
    ]);
  });

  it("合併話は単一話に確定しない（merged）", () => {
    const annict = annictEps(4);
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00006001", "第1話～第4話", "まとめ")],
      annict,
    );
    expect(res.matched).toEqual([]);
    expect(res.unresolved).toEqual([{ partId: "00006001", reason: "merged" }]);
  });

  it("Annict にも合併話として存在する場合は A+C で確定できる", () => {
    // 計測で 2 件あった「Annict 側も合併話として登録されている」ケース。
    const annict = [
      annictEp(1, {
        number: null,
        numberText: "第1話～第4話",
        title: "まとめ",
      }),
    ];
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00006001", "第1話～第4話", "まとめ")],
      annict,
    );
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0]!.annictEpisodeId).toBe(annict[0]!.annictEpisodeId);
  });

  it("追加話（dアニメにだけある配信）は確定しない", () => {
    // dアニメ 13 話に対し Annict は 12 話まで。位置 13 は範囲外、
    // 第13話に一致する Annict 話も無い → 根拠なし。
    const annict = annictEps(12);
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00013013", "第13話", "存在しない回")],
      annict,
    );
    expect(res.matched).toEqual([]);
    expect(res.unresolved[0]!.reason).not.toBe("merged");
  });

  it("dアニメ側で切れたサブタイトルは前方一致で確定する", () => {
    // dアニメは長いサブタイトルを先頭 40 字程度で切る。
    const long =
      "とても長いサブタイトルで表示が切れてしまうケースの再現用テキスト";
    const annict = [
      annictEp(1, { title: `${long}の続きの部分` }),
      annictEp(2, { title: "別タイトル" }),
    ];
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00001001", "第1話", long)],
      annict,
    );
    expect(res.matched).toHaveLength(1);
    expect(res.matched[0]!.annictEpisodeId).toBe(annict[0]!.annictEpisodeId);
  });

  it("B の数字が複数話に一致する場合は ambiguous で確定しない", () => {
    // Annict 側に同じ number の話が複数ある（再放送・話数重複）。
    const annict = [
      annictEp(1, { number: 1 }),
      annictEp(2, { number: 1, numberText: "第1話（再放送）" }),
      annictEp(3),
    ];
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00009099", "第1話", "")],
      annict,
    );
    // B は 2 候補で使えず、A は位置 99 で範囲外 → 根拠なし
    expect(res.matched).toEqual([]);
    expect(res.unresolved).toEqual([
      { partId: "00009099", reason: "ambiguous" },
    ]);
  });

  it("同じ Annict 話に複数の dアニメ話が寄ったら後続は duplicate", () => {
    const annict = annictEps(1, () => ({ title: "同じ話" }));
    const res = matchDanimeWorkEpisodes(
      [
        danimeEp("00001001", "第1話", "同じ話"),
        // partId 位置は外れるが B+C で同じ話を指す重複配信
        danimeEp("00001002", "第1話", "同じ話"),
      ],
      annict,
    );
    expect(res.matched).toHaveLength(1);
    expect(res.unresolved).toEqual([
      { partId: "00001002", reason: "duplicate" },
    ]);
  });

  it("Annict 側に話一覧が無いときは no_annict_episodes", () => {
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00001001", "第1話", "サブ")],
      [],
    );
    expect(res.unresolved).toEqual([
      { partId: "00001001", reason: "no_annict_episodes" },
    ]);
  });

  it("漢数字の話数表記も B 方式で確定する", () => {
    const annict = annictEps(12);
    const res = matchDanimeWorkEpisodes(
      [danimeEp("00012012", "第十二話")],
      annict,
    );
    // A（位置12）と B（12）が一致
    expect(res.matched[0]!.annictEpisodeId).toBe(annict[11]!.annictEpisodeId);
  });
});
