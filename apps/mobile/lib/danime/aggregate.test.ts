import { toMatchWorks } from "@/lib/danime/aggregate";
import type { DanimeExtractedLists } from "@/lib/danime/types";

function lists(partial: Partial<DanimeExtractedLists>): DanimeExtractedLists {
  return { completed: [], history: [], ...partial };
}

describe("toMatchWorks", () => {
  it("completed は WATCHED、history のみは WATCHING にマップする", () => {
    const works = toMatchWorks(
      lists({
        completed: [{ workId: "1", title: "作品A", partIds: [] }],
        history: [
          { workId: "1", title: "作品A", partIds: ["101"] },
          { workId: "2", title: "作品B", partIds: ["201"] },
        ],
      }),
    );
    expect(works).toEqual([
      { danimeWorkId: "1", title: "作品A", targetState: "WATCHED" },
      { danimeWorkId: "2", title: "作品B", targetState: "WATCHING" },
    ]);
  });

  it("history 側の疑似キーが completed の同名作品と重複する場合は弾く", () => {
    const works = toMatchWorks(
      lists({
        completed: [{ workId: "100", title: "作品X", partIds: [] }],
        history: [{ workId: "title:作品X", title: "作品X", partIds: ["999"] }],
      }),
    );
    expect(works).toEqual([
      { danimeWorkId: "100", title: "作品X", targetState: "WATCHED" },
    ]);
  });

  it("completed と同名の別 workId の履歴も弾く（降格防止）", () => {
    // dアニメ側で同一作品に別 workId が振られた場合でも、WATCHED 登録後に
    // WATCHING を上書きしないようタイトル一致で履歴側を落とす。
    const works = toMatchWorks(
      lists({
        completed: [{ workId: "100", title: "作品A", partIds: [] }],
        history: [{ workId: "200", title: "作品Ａ", partIds: ["201"] }],
      }),
    );
    // 全角/半角の差も正規化で吸収して同一視する。
    expect(works).toEqual([
      { danimeWorkId: "100", title: "作品A", targetState: "WATCHED" },
    ]);
  });

  it("タイトルが空白のみのカードは除外する（API スキーマで 400 になるため）", () => {
    const works = toMatchWorks(
      lists({
        completed: [{ workId: "100", title: "作品A", partIds: [] }],
        history: [
          { workId: "200", title: "  ", partIds: ["201"] },
          { workId: "300", title: "作品B", partIds: ["301"] },
        ],
      }),
    );
    expect(works).toEqual([
      { danimeWorkId: "100", title: "作品A", targetState: "WATCHED" },
      { danimeWorkId: "300", title: "作品B", targetState: "WATCHING" },
    ]);
  });

  it("疑似キーでも completed に同名が無ければ WATCHING として残す", () => {
    const works = toMatchWorks(
      lists({
        history: [{ workId: "title:作品Y", title: "作品Y", partIds: ["1"] }],
      }),
    );
    expect(works).toEqual([
      { danimeWorkId: "title:作品Y", title: "作品Y", targetState: "WATCHING" },
    ]);
  });

  it("同じ workId が history に複数回出ても 1 件にする", () => {
    const works = toMatchWorks(
      lists({
        history: [
          { workId: "7", title: "作品Z", partIds: ["701"] },
          { workId: "7", title: "作品Z", partIds: ["702"] },
        ],
      }),
    );
    expect(works).toEqual([
      { danimeWorkId: "7", title: "作品Z", targetState: "WATCHING" },
    ]);
  });

  it("空の場合は空配列を返す", () => {
    expect(toMatchWorks(lists({}))).toEqual([]);
  });
});
