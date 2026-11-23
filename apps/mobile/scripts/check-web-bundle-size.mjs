// `expo export -p web` の出力から「初回に読み込む JS」の gzip サイズを計測し、
// ページごとの合計が上限を超えたら非ゼロで終了する（issue #721）。
//
// 「初回に読み込む JS」は export 物の各 *.html が <script src> で読み込む
// ファイルの集合から決める。チャンク名やファイル名のハッシュに依存しないため、
// Sentry のような動的 import（遅延チャンク）は HTML に現れず自然に対象外になる。
//
// 使い方:
//   node scripts/check-web-bundle-size.mjs [--dist <dir>] [--max-bytes <n>]
//       [--baseline <report.json>] [--write-report <report.json>]
//       [--label <text>] [--no-check]
//
// いずれも apps/mobile 直下からの実行を想定するが、--dist はどこからでもよい。
// GITHUB_STEP_SUMMARY があればレポートを Markdown で追記する。

import {
  readdirSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

// ページあたりの初回 JS 合計（gzip）の上限。
// 根拠・計測値・変更手順は docs/development/web-bundle-size.md。
export const BUDGET_GZIP_BYTES = Math.round(1.2 * 1024 * 1024); // 1,258,291 B

const DEFAULT_DIST = path.resolve(import.meta.dirname, "../dist");

/**
 * HTML から <script src="..."> の URL を取り出す。src を持たない
 * inline script（ld+json・RSC ペイロード等）は対象外。
 * @param {string} html
 * @returns {string[]}
 */
export function extractScriptSrcs(html) {
  const srcs = [];
  const re = /<script\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gis;
  for (const m of html.matchAll(re)) srcs.push(m[2]);
  return srcs;
}

/**
 * script の URL を dist 内のファイルパスに解決する。
 * 外部 URL / data: は null を返す。
 * @param {string} distDir
 * @param {string} htmlPath dist 内の HTML ファイルの絶対パス
 * @param {string} src
 * @returns {string | null}
 */
function resolveScriptFile(distDir, htmlPath, src) {
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(src) || src.startsWith("data:")) {
    return null;
  }
  const pathname = decodeURIComponent(src.split(/[?#]/)[0]);
  if (pathname.startsWith("/")) {
    return path.join(distDir, pathname.slice(1));
  }
  return path.resolve(path.dirname(htmlPath), pathname);
}

function listHtmlFiles(dir, base = dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listHtmlFiles(full, base));
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(path.relative(base, full));
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

/**
 * dist 以下の全 *.html について、<script src> が読むファイルの
 * バイト数と gzip サイズを計測する。
 * @param {string} distDir
 * @returns {{pages: Array, missing: string[]}}
 */
export function measureDist(distDir) {
  let htmlFiles;
  try {
    htmlFiles = listHtmlFiles(distDir);
  } catch (e) {
    if (e.code === "ENOENT") {
      throw new Error(
        `${distDir} が見つかりません。先に expo export -p web を実行してください`,
      );
    }
    throw e;
  }
  if (htmlFiles.length === 0) {
    throw new Error(`${distDir} に *.html がありません`);
  }

  const gzipCache = new Map();
  const pages = [];
  const missing = [];

  for (const page of htmlFiles) {
    const htmlPath = path.join(distDir, page);
    const html = readFileSync(htmlPath, "utf8");
    const scripts = [];
    const seen = new Set();
    for (const src of extractScriptSrcs(html)) {
      const file = resolveScriptFile(distDir, htmlPath, src);
      if (file === null || seen.has(file)) continue;
      seen.add(file);
      if (!gzipCache.has(file)) {
        let content;
        try {
          content = readFileSync(file);
        } catch (e) {
          if (e.code === "ENOENT") {
            missing.push(`${page}: ${src}`);
            continue;
          }
          throw e;
        }
        gzipCache.set(file, {
          file: path.relative(distDir, file),
          bytes: content.byteLength,
          gzip: gzipSync(content).byteLength,
        });
      }
      scripts.push(gzipCache.get(file));
    }
    pages.push({
      page,
      totalBytes: scripts.reduce((s, f) => s + f.bytes, 0),
      totalGzip: scripts.reduce((s, f) => s + f.gzip, 0),
      scripts: scripts.sort((a, b) => b.gzip - a.gzip),
    });
  }
  pages.sort((a, b) => b.totalGzip - a.totalGzip);
  return { pages, missing };
}

/**
 * 上限超過のページ一覧を返す。空なら予算内。
 * @param {{pages: Array}} report
 * @param {number} budgetGzipBytes
 */
export function budgetViolations(report, budgetGzipBytes) {
  return report.pages.filter((p) => p.totalGzip > budgetGzipBytes);
}

/**
 * baseline レポート（--write-report の出力）との差分をページ単位で計算する。
 * @returns {Array<{page, baseGzip, headGzip, delta}>}
 */
export function diffReports(baseReport, headReport) {
  const basePages = new Map(baseReport.pages.map((p) => [p.page, p]));
  const headPages = new Map(headReport.pages.map((p) => [p.page, p]));
  const rows = [];
  for (const [page, head] of headPages) {
    const base = basePages.get(page);
    rows.push({
      page,
      baseGzip: base ? base.totalGzip : null,
      headGzip: head.totalGzip,
      delta: base ? head.totalGzip - base.totalGzip : null,
    });
  }
  for (const [page, base] of basePages) {
    if (!headPages.has(page)) {
      rows.push({
        page,
        baseGzip: base.totalGzip,
        headGzip: null,
        delta: -base.totalGzip,
      });
    }
  }
  rows.sort(
    (a, b) => Math.abs(b.delta ?? b.headGzip) - Math.abs(a.delta ?? a.headGzip),
  );
  return rows;
}

const fmt = (n) => (n === null ? "-" : n.toLocaleString("en-US"));
const fmtDelta = (n) => (n === null ? "(new)" : n > 0 ? `+${fmt(n)}` : fmt(n));

/**
 * レポート全体を Markdown で組み立てる。
 * @param {{pages: Array, label: string}} report
 * @param {{budgetGzipBytes: number, baseline: object | null}} options
 * @returns {string}
 */
export function renderMarkdown(report, { budgetGzipBytes, baseline }) {
  const lines = [];
  lines.push(`## Web 初回 JS バンドルサイズ（gzip）`);
  lines.push("");
  lines.push(
    `各 *.html が \`<script src>\` で読み込むファイルの合計。上限はページあたり ${fmt(budgetGzipBytes)} B。`,
  );
  if (report.label) lines.push(`対象: ${report.label}`);
  lines.push("");

  const violations = new Set(
    budgetViolations(report, budgetGzipBytes).map((p) => p.page),
  );
  const shown = report.pages.slice(0, 8);
  const indexPage = report.pages.find((p) => p.page === "index.html");
  if (indexPage && !shown.includes(indexPage)) shown.push(indexPage);
  lines.push("| page | gzip (B) | raw (B) |");
  lines.push("| --- | ---: | ---: |");
  for (const p of shown) {
    const mark = violations.has(p.page) ? " ❌" : "";
    lines.push(
      `| ${p.page}${mark} | ${fmt(p.totalGzip)} | ${fmt(p.totalBytes)} |`,
    );
  }
  if (report.pages.length > shown.length) {
    lines.push(`| …（全 ${report.pages.length} ページ） | | |`);
  }
  lines.push("");

  if (indexPage) {
    lines.push(`<details><summary>index.html の内訳</summary>`);
    lines.push("");
    lines.push("| file | gzip (B) | raw (B) |");
    lines.push("| --- | ---: | ---: |");
    for (const s of indexPage.scripts) {
      lines.push(`| ${s.file} | ${fmt(s.gzip)} | ${fmt(s.bytes)} |`);
    }
    lines.push("");
    lines.push(`</details>`);
    lines.push("");
  }

  if (baseline) {
    const rows = diffReports(baseline, report);
    const changed = rows.filter((r) => r.delta !== 0);
    lines.push(`### baseline（${baseline.label ?? "report"}）との差分`);
    lines.push("");
    if (changed.length === 0) {
      lines.push("変化なし");
    } else {
      lines.push("| page | base (B) | head (B) | Δ (B) |");
      lines.push("| --- | ---: | ---: | ---: |");
      const head = changed
        .sort(
          (a, b) =>
            (b.page === "index.html") - (a.page === "index.html") ||
            Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0),
        )
        .slice(0, 12);
      for (const r of head) {
        lines.push(
          `| ${r.page} | ${fmt(r.baseGzip)} | ${fmt(r.headGzip)} | ${fmtDelta(r.delta)} |`,
        );
      }
      if (changed.length > head.length) {
        lines.push(`| …（他 ${changed.length - head.length} ページ） | | | |`);
      }
    }
    lines.push("");
  }

  if (violations.size > 0) {
    const names = report.pages
      .filter((p) => violations.has(p.page))
      .slice(0, 10)
      .map((p) => p.page)
      .join(", ");
    const rest =
      violations.size > 10 ? ` 他 ${violations.size - 10} ページ` : "";
    lines.push(`**${violations.size} ページが上限超過**: ${names}${rest}`);
    lines.push("");
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  if (argv.includes("--help")) {
    console.log(
      "usage: node scripts/check-web-bundle-size.mjs [--dist <dir>] [--max-bytes <n>] [--baseline <report.json>] [--write-report <report.json>] [--label <text>] [--no-check]",
    );
    process.exit(0);
  }
  const opts = {
    dist: DEFAULT_DIST,
    maxBytes: BUDGET_GZIP_BYTES,
    baseline: null,
    writeReport: null,
    label: null,
    check: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const take = (name) => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${name} に値が必要です`);
      return v;
    };
    switch (argv[i]) {
      case "--dist":
        opts.dist = path.resolve(take("--dist"));
        break;
      case "--max-bytes":
        opts.maxBytes = Number(take("--max-bytes"));
        if (!Number.isFinite(opts.maxBytes))
          throw new Error("--max-bytes は数値で指定してください");
        break;
      case "--baseline":
        opts.baseline = take("--baseline");
        break;
      case "--write-report":
        opts.writeReport = take("--write-report");
        break;
      case "--label":
        opts.label = take("--label");
        break;
      case "--no-check":
        opts.check = false;
        break;
      default:
        throw new Error(`不明な引数: ${argv[i]}`);
    }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { pages, missing } = measureDist(opts.dist);
  if (missing.length > 0) {
    console.error("HTML が参照するファイルが見つかりません:");
    for (const m of missing) console.error(`  ${m}`);
    process.exit(2);
  }

  const report = { schemaVersion: 1, label: opts.label, pages };

  let baseline = null;
  if (opts.baseline) {
    baseline = JSON.parse(readFileSync(opts.baseline, "utf8"));
  }
  if (opts.writeReport) {
    writeFileSync(opts.writeReport, JSON.stringify(report, null, 2) + "\n");
  }

  const markdown = renderMarkdown(report, {
    budgetGzipBytes: opts.maxBytes,
    baseline,
  });
  console.log(markdown);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  }

  if (opts.check) {
    const violations = budgetViolations(report, opts.maxBytes);
    if (violations.length > 0) {
      console.error(
        `\n初回 JS が上限（${opts.maxBytes.toLocaleString("en-US")} B/ページ）を超えています:`,
      );
      for (const p of violations.slice(0, 10)) {
        console.error(`  ${p.page}: ${p.totalGzip.toLocaleString("en-US")} B`);
      }
      if (violations.length > 10) {
        console.error(`  …他 ${violations.length - 10} ページ`);
      }
      console.error(
        "遅延 import への切り出し・依存の見直しを検討し、やむを得ない場合は" +
          " scripts/check-web-bundle-size.mjs の BUDGET_GZIP_BYTES を" +
          " 根拠付きで更新してください（docs/development/web-bundle-size.md）。",
      );
      process.exit(1);
    }
    const max = report.pages[0];
    console.log(
      `\nOK: 最大 ${max.page} = ${max.totalGzip.toLocaleString("en-US")} B / 上限 ${opts.maxBytes.toLocaleString("en-US")} B`,
    );
  }
}

const invokedAs =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAs) {
  try {
    main();
  } catch (e) {
    console.error(e.message ?? e);
    process.exit(2);
  }
}
