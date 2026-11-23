import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  budgetViolations,
  diffReports,
  extractScriptSrcs,
  measureDist,
} from "./check-web-bundle-size.mjs";

let dist: string;

beforeEach(() => {
  dist = mkdtempSync(path.join(tmpdir(), "bundle-size-"));
});

afterEach(() => {
  rmSync(dist, { recursive: true, force: true });
});

function addFile(rel: string, content: string) {
  const full = path.join(dist, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

describe("extractScriptSrcs", () => {
  it("src を持つ script タグだけを URL 順に取り出す", () => {
    const html = `
      <script type="application/ld+json">{}</script>
      <script defer src="/_expo/static/js/web/__common-abc123.js"></script>
      <script id="_R_">payload</script>
      <script defer='src=ignored.js'></script>
      <script src='./relative-1.js' async></script>
      <script defer src="/_expo/static/js/web/index-def456.js"></script>
    `;
    expect(extractScriptSrcs(html)).toEqual([
      "/_expo/static/js/web/__common-abc123.js",
      "./relative-1.js",
      "/_expo/static/js/web/index-def456.js",
    ]);
  });
});

describe("measureDist", () => {
  it("各 HTML が読む script の gzip 合計をページごとに返す", () => {
    addFile("a.js", "a".repeat(1000));
    addFile("b.js", "b".repeat(500));
    addFile(
      "index.html",
      '<script defer src="/a.js"></script><script defer src="/b.js"></script>',
    );
    addFile(
      "route/index.html",
      '<script defer src="/a.js"></script><script defer src="../c.js"></script>',
    );
    addFile("c.js", "c".repeat(100));
    // どの HTML からも読まれない遅延チャンクはページの合計に入らない
    addFile("lazy.js", "lazy".repeat(10000));

    const { pages, missing } = measureDist(dist);
    expect(missing).toEqual([]);
    const byPage = new Map(pages.map((p) => [p.page, p]));
    const index = byPage.get("index.html");
    const route = byPage.get(path.join("route", "index.html"));
    // scripts は gzip 降順（a.js > b.js）
    expect(index?.scripts.map((s: { file: string }) => s.file)).toEqual([
      "a.js",
      "b.js",
    ]);
    expect(index?.totalGzip).toBe(
      index.scripts.reduce((s: number, f: { gzip: number }) => s + f.gzip, 0),
    );
    expect(route?.scripts.map((s: { file: string }) => s.file)).toEqual([
      "a.js",
      "c.js",
    ]);
    expect(route?.totalGzip).toBeGreaterThan(0);
  });

  it("外部 URL と data: の script は計測対象にしない", () => {
    addFile("a.js", "a".repeat(100));
    addFile(
      "index.html",
      '<script src="https://cdn.example.com/x.js"></script>' +
        '<script src="//cdn.example.com/y.js"></script>' +
        '<script defer src="/a.js"></script>',
    );
    const { pages } = measureDist(dist);
    expect(pages[0].scripts.map((s: { file: string }) => s.file)).toEqual([
      "a.js",
    ]);
  });

  it("HTML が参照するファイルが無いとき missing に列挙する", () => {
    addFile("index.html", '<script defer src="/gone.js"></script>');
    const { missing } = measureDist(dist);
    expect(missing).toEqual(["index.html: /gone.js"]);
  });

  it("dist が無いとき案内メッセージで失敗する", () => {
    expect(() => measureDist(path.join(dist, "nope"))).toThrow(
      "expo export -p web",
    );
  });
});

describe("budgetViolations", () => {
  it("上限超過のページだけを返す", () => {
    const report = {
      pages: [
        { page: "a.html", totalGzip: 100 },
        { page: "b.html", totalGzip: 201 },
      ],
    };
    expect(budgetViolations(report, 200).map((p) => p.page)).toEqual([
      "b.html",
    ]);
    expect(budgetViolations(report, 300)).toEqual([]);
  });
});

describe("diffReports", () => {
  it("ページの増減とサイズ差分を返す", () => {
    const base = {
      pages: [
        { page: "index.html", totalGzip: 1000 },
        { page: "gone.html", totalGzip: 300 },
      ],
    };
    const head = {
      pages: [
        { page: "index.html", totalGzip: 1200 },
        { page: "new.html", totalGzip: 50 },
      ],
    };
    const rows = diffReports(base, head);
    const byPage = new Map(rows.map((r) => [r.page, r]));
    expect(byPage.get("index.html")?.delta).toBe(200);
    expect(byPage.get("new.html")?.delta).toBeNull();
    expect(byPage.get("gone.html")?.delta).toBe(-300);
  });
});
