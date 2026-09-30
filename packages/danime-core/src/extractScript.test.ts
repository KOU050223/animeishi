// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://animestore.docomo.ne.jp/animestore/mpa_hst_pc?workType=0"}
// 抽出スクリプト（DANIME_EXTRACT_SCRIPT）を jsdom 上で実際に eval して、
// dアニメページ風のフィクスチャ HTML からの抽出・ページング・エラー分岐を検証する。
// oxlint-disable: eval / javascript: URL はこのテストの検証対象そのもの。
/* oxlint-disable no-eval, no-script-url */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DANIME_EXTRACT_ERR,
  DANIME_EXTRACT_OK,
  DANIME_EXTRACT_SCRIPT,
  DANIME_POSTBACK_ACK,
  DANIME_POSTBACK_DATA,
  buildDanimeBookmarklet,
  danimeExtractScript,
} from "./extractScript";
import { DANIME_EXTRACT_SCHEMA_VERSION } from "./types";

type PostMessage = { type: string; payload?: unknown; message?: string };

let postMessage: ReturnType<typeof vi.fn>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  postMessage = vi.fn();
  (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = {
    postMessage,
  };
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

// jsdom には Response が無いため、スクリプトが使うフィールドだけのスタブを返す。
function htmlResponse(html: string, url = "") {
  return {
    ok: true,
    status: 200,
    url,
    text: async () => html,
  };
}

// ページフォーム + ページャ + カードを持つフィクスチャを組み立てる。
function pageHtml(opts: {
  cards: { workId?: string; title: string; partIds?: string[] }[];
  current?: number;
  total?: number;
  spDuplicate?: boolean;
}): string {
  const card = (c: { workId?: string; title: string; partIds?: string[] }) => `
    <div class="itemWrapper clearfix">
      <div class="itemModule">
        <section>
          <header><p class="line1"></p><p class="line2">${c.title}</p></header>
          <div class="textContainer">
            ${(c.partIds ?? [])
              .map(
                (p) =>
                  `<a href="/animestore/ci?workId=${c.workId}&partId=${p}"><h3 class="line2">第1話</h3></a>`,
              )
              .join("")}
          </div>
          ${c.workId ? `<input type="hidden" class="workId" value="${c.workId}"/>` : ""}
        </section>
      </div>
    </div>`;
  const sp = opts.spDuplicate
    ? `<div class="itemWrapper clearfix onlySpLayout">${opts.cards.map(card).join("")}</div>`
    : "";
  return `<html><body>
    <form name="pageForm">
      <input name="workType" value="0"/>
      <input name="editModeFlag" value=""/>
      <input name="selectPage" value="${opts.current ?? 1}"/>
    </form>
    <div class="paging"><p class="onlySpLayout">${opts.current ?? 1} / ${opts.total ?? 1}</p></div>
    ${opts.cards.map(card).join("")}
    ${sp}
  </body></html>`;
}

async function runScript(): Promise<PostMessage> {
  // eval は IIFE の Promise を返す。スクリプト内の非同期処理完了を待つ。
  const promise = eval(DANIME_EXTRACT_SCRIPT) as Promise<void>;
  await promise;
  expect(postMessage).toHaveBeenCalledTimes(1);
  return JSON.parse(postMessage.mock.calls[0]?.[0] as string) as PostMessage;
}

describe("DANIME_EXTRACT_SCRIPT", () => {
  it("コンプリートと履歴の両ページから作品を抽出して postMessage する", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("mpa_cmp_pc")) {
        return htmlResponse(
          pageHtml({ cards: [{ workId: "101", title: "作品A" }] }),
        );
      }
      return htmlResponse(
        pageHtml({
          cards: [
            { workId: "201", title: "作品B", partIds: ["20101"] },
            { workId: "202", title: "作品C", partIds: ["20201", "20202"] },
          ],
        }),
      );
    });

    const msg = await runScript();
    expect(msg.type).toBe(DANIME_EXTRACT_OK);
    const payload = msg.payload as {
      schemaVersion: number;
      completed: { workId: string; title: string }[];
      history: { workId: string; title: string; partIds: string[] }[];
      extractElapsedMs?: number;
    };
    expect(payload.schemaVersion).toBe(DANIME_EXTRACT_SCHEMA_VERSION);
    expect(payload.completed).toEqual([
      { workId: "101", title: "作品A", partIds: [] },
    ]);
    expect(payload.history).toEqual([
      { workId: "201", title: "作品B", partIds: ["20101"] },
      { workId: "202", title: "作品C", partIds: ["20201", "20202"] },
    ]);
    // 所要時間の可視化: 抽出フェーズの経過時間を payload に含める。
    expect(typeof payload.extractElapsedMs).toBe("number");
    expect(payload.extractElapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("ページング: selectPage を全ページ分 fetch して結合する", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("mpa_cmp_pc")) {
        return htmlResponse(pageHtml({ cards: [] }));
      }
      if (url.includes("selectPage=2")) {
        return htmlResponse(
          pageHtml({
            current: 2,
            total: 2,
            cards: [{ workId: "302", title: "2ページ目の作品" }],
          }),
        );
      }
      return htmlResponse(
        pageHtml({
          total: 2,
          cards: [{ workId: "301", title: "1ページ目の作品" }],
        }),
      );
    });

    const msg = await runScript();
    const payload = msg.payload as {
      history: { workId: string }[];
      completed: unknown[];
    };
    // completed が空でも history にデータがあれば成功として扱う。
    expect(payload.history.map((w) => w.workId).sort()).toEqual(["301", "302"]);
  });

  it("同一 workId の重複カードは partId をマージして 1 件にする", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("mpa_cmp_pc")) {
        return htmlResponse(pageHtml({ cards: [] }));
      }
      return htmlResponse(
        pageHtml({
          cards: [
            { workId: "401", title: "作品D", partIds: ["40101"] },
            { workId: "401", title: "作品D", partIds: ["40102"] },
          ],
        }),
      );
    });

    const msg = await runScript();
    const payload = msg.payload as {
      history: { workId: string; partIds: string[] }[];
    };
    expect(payload.history).toEqual([
      { workId: "401", title: "作品D", partIds: ["40101", "40102"] },
    ]);
  });

  it("SP 用の onlySpLayout 複製カードは二重カウントしない", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("mpa_cmp_pc")) {
        return htmlResponse(pageHtml({ cards: [] }));
      }
      return htmlResponse(
        pageHtml({
          cards: [{ workId: "501", title: "作品E", partIds: ["50101"] }],
          spDuplicate: true,
        }),
      );
    });

    const msg = await runScript();
    const payload = msg.payload as { history: { workId: string }[] };
    expect(payload.history).toHaveLength(1);
  });

  it("input.workId が無いカードはリンクの workId= クエリにフォールバックする", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("mpa_cmp_pc")) {
        return htmlResponse(pageHtml({ cards: [] }));
      }
      return htmlResponse(
        `<html><body>
          <div class="itemWrapper clearfix">
            <div class="itemModule"><section>
              <div class="textContainer">
                <a href="/animestore/sc_d_pc?workId=601"><h3 class="line2">リンクのみ作品</h3></a>
              </div>
            </section></div>
          </div>
        </body></html>`,
      );
    });

    const msg = await runScript();
    const payload = msg.payload as {
      history: { workId: string; title: string }[];
    };
    expect(payload.history).toEqual([
      { workId: "601", title: "リンクのみ作品", partIds: [] },
    ]);
  });

  it("未ログイン（auth リダイレクト）は not_logged_in エラーを返す", async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(
        "<html><body>login page</body></html>",
        "https://animestore.docomo.ne.jp/animestore/auth",
      ),
    );

    const msg = await runScript();
    expect(msg.type).toBe(DANIME_EXTRACT_ERR);
    expect(msg.message).toBe("not_logged_in");
  });

  it("両リストが空なら empty_result エラーを返す（構造変更の検知）", async () => {
    fetchMock.mockImplementation(async () =>
      htmlResponse(pageHtml({ cards: [] })),
    );

    const msg = await runScript();
    expect(msg.type).toBe(DANIME_EXTRACT_ERR);
    expect(msg.message).toBe("empty_result");
  });

  it("dアニメ以外のページで実行すると fetch せず wrong_page を返す", async () => {
    // direct eval は呼び出しスコープの変数を見るため、ローカルの location で
    // グローバルを覆い「別オリジンで実行された」状況を再現する。
    // oxlint-disable-next-line no-unused-vars -- eval 内スクリプトが参照する
    const location = { hostname: "pr-111-animeishi.example.dev" };

    await eval(DANIME_EXTRACT_SCRIPT);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(postMessage).toHaveBeenCalledTimes(1);
    const msg = JSON.parse(postMessage.mock.calls[0]?.[0] as string);
    expect(msg.type).toBe(DANIME_EXTRACT_ERR);
    expect(msg.message).toBe("wrong_page");
  });

  it("fetch が reject される（ネットワーク障害）と network_error を返す", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const msg = await runScript();
    expect(msg.type).toBe(DANIME_EXTRACT_ERR);
    expect(msg.message).toBe("network_error");
  });

  it("HTTP エラーは失敗メッセージとして報告する", async () => {
    fetchMock.mockImplementation(async () => ({
      ok: false,
      status: 500,
      url: "",
      text: async () => "oops",
    }));

    const msg = await runScript();
    expect(msg.type).toBe(DANIME_EXTRACT_ERR);
    expect(msg.message).toBe("HTTP 500");
  });
});

describe("ブックマークレット経路（ReactNativeWebView なし）", () => {
  const APP_ORIGIN = "https://animeishi.example";
  let appWin: {
    postMessage: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let alertMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // WebView 経路ではないので ReactNativeWebView を消し、window.open の
    // 返り値をアプリ側タブのスタブにする。
    delete (window as unknown as { ReactNativeWebView?: unknown })
      .ReactNativeWebView;
    appWin = { postMessage: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockImplementation(
      () => appWin as unknown as Window,
    );
    alertMock = vi.fn();
    window.alert = alertMock as unknown as typeof window.alert;

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("mpa_cmp_pc")) {
        return htmlResponse(
          pageHtml({ cards: [{ workId: "101", title: "作品A" }] }),
        );
      }
      return htmlResponse(
        pageHtml({ cards: [{ workId: "201", title: "作品B" }] }),
      );
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Animeishi 受信タブを開き postMessage で抽出結果を転送する", async () => {
    await eval(danimeExtractScript(APP_ORIGIN));

    // 受信タブは抽出前に同期で開かれる（ポップアップブロック対策）。
    expect(window.open).toHaveBeenCalledWith(
      `${APP_ORIGIN}/danime-import?recv=1`,
      "_blank",
    );
    // 結果は ReactNativeWebView ではなく受信タブへの postMessage で送る。
    expect(postMessage).not.toHaveBeenCalled();
    expect(appWin.postMessage).toHaveBeenCalled();
    const [msg, origin] = appWin.postMessage.mock.calls[0]! as [
      {
        type: string;
        payload: {
          schemaVersion: number;
          completed: { workId: string }[];
        };
      },
      string,
    ];
    expect(origin).toBe(APP_ORIGIN);
    expect(msg.type).toBe(DANIME_POSTBACK_DATA);
    expect(msg.payload.schemaVersion).toBe(DANIME_EXTRACT_SCHEMA_VERSION);
    expect(msg.payload.completed[0]?.workId).toBe("101");
  });

  it("ack を受け取ると転送完了を通知する", async () => {
    await eval(danimeExtractScript(APP_ORIGIN));
    expect(alertMock).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: DANIME_POSTBACK_ACK },
        source: appWin as unknown as Window,
        origin: APP_ORIGIN,
      }),
    );
    expect(alertMock).toHaveBeenCalledWith(
      expect.stringContaining("転送しました"),
    );
  });

  it("抽出に失敗した場合は開いた受信タブを閉じてエラーを通知する", async () => {
    // 未ログイン判定は res.url に /animestore/auth を含むこと。
    fetchMock.mockImplementation(async () =>
      htmlResponse(
        "<html><body>login</body></html>",
        "https://animestore.docomo.ne.jp/animestore/auth",
      ),
    );

    await eval(danimeExtractScript(APP_ORIGIN));
    expect(appWin.close).toHaveBeenCalled();
    expect(alertMock).toHaveBeenCalledWith(expect.stringContaining("ログイン"));
  });
});

describe("buildDanimeBookmarklet", () => {
  it("javascript: URL で、percent-decode 後に抽出コアとして実行できる", async () => {
    const bm = buildDanimeBookmarklet("https://animeishi.example");
    expect(bm.startsWith("javascript:")).toBe(true);

    // ブラウザは javascript: URL を実行前に percent-decode する。
    // デコード後のコードが構文エラーなく動くことを実際に eval で確認する
    // （生の // コメントや正規表現中の # が URL を壊さないことの回帰テスト）。
    const code = decodeURIComponent(bm.slice("javascript:".length));
    expect(code).toContain("mpa_hst_pc");
    expect(code).toContain("mpa_cmp_pc");
    // 転送先オリジンが埋め込まれている。
    expect(code).toContain("https://animeishi.example");

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("mpa_cmp_pc")) {
        return htmlResponse(
          pageHtml({ cards: [{ workId: "101", title: "作品A" }] }),
        );
      }
      return htmlResponse(
        pageHtml({ cards: [{ workId: "201", title: "作品B" }] }),
      );
    });
    await eval(code);
    expect(postMessage).toHaveBeenCalledTimes(1);
    const msg = JSON.parse(postMessage.mock.calls[0]?.[0] as string);
    expect(msg.type).toBe(DANIME_EXTRACT_OK);
  });
});
