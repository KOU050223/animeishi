#!/usr/bin/env node
// 運営が登録するイベント（issue #411）を frontmatter 付き Markdown から
// D1 に投入する運営用スクリプト。#437 の記事と同じ仕組み
// （lib/frontmatter-content.mjs の slug upsert）。通常は Taskfile 経由で実行する:
//   pnpm task events:publish -- <イベント.md のパス>          # 本番（確認プロンプト付き）
//   pnpm task events:publish:preview -- <イベント.md のパス>  # プレビュー
//   pnpm task events:publish:local -- <イベント.md のパス>    # ローカル D1
//
// 直接実行:
//   node scripts/publish-event.mjs [--env production|preview | --local] <イベント.md のパス>
//
// Markdown ファイルの形式（イベントファイルはリポジトリに入れない）:
//   ---
//   slug: comiket-107                    # 必須。[a-z0-9][a-z0-9-]*。イベント詳細の URL になる
//   title: コミックマーケット107           # 必須
//   starts_at: 2026-12-20T10:00:00+09:00 # 必須。会期開始（ISO 8601）
//   ends_at: 2026-12-21T16:00:00+09:00   # 必須。会期終了。starts_at より後
//   location: 東京ビッグサイト             # 省略可。会場名
//   official_url: https://...            # 省略可。公式サイト
//   cover_image_url: https://...         # 省略可。一覧カードと詳細上部に出す画像
//   published_at: 2026-11-10T09:00:00+09:00    # 必須。アプリへの公開開始日時
//   unpublished_at: 2026-12-25T00:00:00+09:00  # 省略可。公開終了日時。無いと終了期限なし
//   ---
//   説明文 Markdown（省略可。空なら body は NULL）
//
// 同じ slug のイベントがあれば上書きする（upsert）。created_at は初回投入時を
// 保持する。イベントを公開終了にするだけなら unpublished_at を過去日時にして
// 再投入する。

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildUpsertSql,
  parseFrontmatterDocument,
  sqlLiteral,
} from "./lib/frontmatter-content.mjs";
import { buildEventRow } from "./lib/event-content.mjs";

function parseArgs(argv) {
  let env = "production";
  let local = false;
  let file;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--local") {
      local = true;
    } else if (arg === "--env") {
      env = argv[++i] ?? "";
    } else if (arg.startsWith("--env=")) {
      env = arg.slice("--env=".length);
    } else if (arg === "-h" || arg === "--help") {
      return { help: true };
    } else if (arg.startsWith("-")) {
      throw new Error(`不明な引数: ${arg}`);
    } else if (file === undefined) {
      file = arg;
    } else {
      throw new Error(`イベントファイルは 1 つだけ指定してください: ${arg}`);
    }
  }
  return { env, local, file };
}

function help() {
  console.log(
    "使い方: node scripts/publish-event.mjs [--env production|preview | --local] <イベント.md のパス>\n" +
      "frontmatter の項目はこのファイル冒頭のコメントを参照。",
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    help();
    return;
  }
  if (!args.file) {
    help();
    process.exit(1);
  }
  if (!args.local && args.env !== "production" && args.env !== "preview") {
    throw new Error(`不明な --env: ${args.env}（production|preview のみ）`);
  }

  const filePath = resolve(args.file);
  const source = readFileSync(filePath, "utf8");
  const { attributes, body } = parseFrontmatterDocument(source, {
    fileName: args.file,
  });
  const eventRow = buildEventRow(attributes, body);

  const now = Math.floor(Date.now() / 1000);
  const sql = [
    buildUpsertSql({
      table: "events",
      conflictColumns: ["slug"],
      // created_at は再投入で上書きしない
      keepOnUpdate: ["created_at"],
      row: { ...eventRow, created_at: now, updated_at: now },
    }),
    `SELECT slug, title, location, datetime(starts_at, 'unixepoch') AS starts_at, datetime(ends_at, 'unixepoch') AS ends_at, datetime(published_at, 'unixepoch') AS published_at, datetime(unpublished_at, 'unixepoch') AS unpublished_at FROM events WHERE slug = ${sqlLiteral(eventRow.slug)};`,
  ].join("\n");

  const tmpFile = join(
    tmpdir(),
    `animeishi-event-${process.pid}-${Date.now()}.sql`,
  );
  writeFileSync(tmpFile, sql);

  const dbName =
    args.env === "preview" ? "animeishi-db-preview" : "animeishi-db";
  // -y: リモート実行時に wrangler が出す確認プロンプトを自動承認する。
  // 本番への確認は Taskfile 側の prompt: が担う（publish-article.mjs と同じ設計）。
  const d1Target = args.local
    ? ["--local"]
    : ["--remote", "--env", args.env, "-y"];

  // wrangler は apps/api にだけ入っているため、どこから呼んでも
  // apps/api で実行する（publish-article.mjs と同じ考え方）。
  const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const result = spawnSync(
      "pnpm",
      ["wrangler", "d1", "execute", dbName, ...d1Target, `--file=${tmpFile}`],
      { stdio: "inherit", cwd: apiDir },
    );
    if (result.status !== 0) {
      process.exit(result.status ?? 1);
    }
  } finally {
    rmSync(tmpFile, { force: true });
  }
}

try {
  main();
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
