#!/usr/bin/env node
// 特集記事（issue #437）を frontmatter 付き Markdown から D1 に投入する
// 運営用スクリプト。通常は Taskfile 経由で実行する:
//   pnpm task articles:publish -- <記事.md のパス>          # 本番（確認プロンプト付き）
//   pnpm task articles:publish:preview -- <記事.md のパス>  # プレビュー
//   pnpm task articles:publish:local -- <記事.md のパス>    # ローカル D1
//
// 直接実行:
//   node scripts/publish-article.mjs [--env production|preview | --local] <記事.md のパス>
//
// Markdown ファイルの形式:
//   ---
//   slug: autumn-2026                # 必須。[a-z0-9][a-z0-9-]*。記事詳細の URL になる
//   title: 今期の特集                 # 必須
//   cover_image_url: https://...     # 省略可。特集枠のカードと詳細上部に出す画像
//   published_at: 2026-11-10T09:00:00+09:00   # 必須。公開開始日時（ISO 8601）
//   unpublished_at: 2026-12-01T00:00:00+09:00 # 省略可。公開終了日時。無いと終了期限なし
//   ---
//   本文 Markdown
//
// 同じ slug の記事があれば上書きする（upsert）。created_at は初回投入時を
// 保持する。記事を公開終了にするだけなら unpublished_at を過去日時にして
// 再投入する。

import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildUpsertSql,
  frontmatterDateToUnix,
  frontmatterRequiredString,
  parseFrontmatterDocument,
  sqlLiteral,
} from "./lib/frontmatter-content.mjs";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

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
      throw new Error(`記事ファイルは 1 つだけ指定してください: ${arg}`);
    }
  }
  return { env, local, file };
}

function help() {
  console.log(
    "使い方: node scripts/publish-article.mjs [--env production|preview | --local] <記事.md のパス>\n" +
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

  const slug = frontmatterRequiredString(attributes.slug, { field: "slug" });
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `slug の形式が正しくありません: ${slug}（小文字英数字とハイフンのみ、先頭は英数字）`,
    );
  }
  const title = frontmatterRequiredString(attributes.title, {
    field: "title",
  });
  const publishedAt = frontmatterDateToUnix(attributes.published_at, {
    field: "published_at",
    required: true,
  });
  const unpublishedAt = frontmatterDateToUnix(attributes.unpublished_at, {
    field: "unpublished_at",
  });
  if (unpublishedAt !== null && unpublishedAt <= publishedAt) {
    throw new Error(
      "unpublished_at は published_at より後の日時にしてください",
    );
  }
  if (body.trim() === "") {
    throw new Error("本文（frontmatter 以降の Markdown）が空です");
  }
  const coverImageUrl =
    attributes.cover_image_url === undefined ||
    attributes.cover_image_url === null
      ? null
      : frontmatterRequiredString(attributes.cover_image_url, {
          field: "cover_image_url",
        });

  const now = Math.floor(Date.now() / 1000);
  const sql = [
    buildUpsertSql({
      table: "articles",
      conflictColumns: ["slug"],
      // created_at は再投入で上書きしない
      keepOnUpdate: ["created_at"],
      row: {
        slug,
        title,
        body,
        cover_image_url: coverImageUrl,
        published_at: publishedAt,
        unpublished_at: unpublishedAt,
        created_at: now,
        updated_at: now,
      },
    }),
    `SELECT slug, title, cover_image_url, datetime(published_at, 'unixepoch') AS published_at, datetime(unpublished_at, 'unixepoch') AS unpublished_at FROM articles WHERE slug = ${sqlLiteral(slug)};`,
  ].join("\n");

  const tmpFile = join(
    tmpdir(),
    `animeishi-article-${process.pid}-${Date.now()}.sql`,
  );
  writeFileSync(tmpFile, sql);

  const dbName =
    args.env === "preview" ? "animeishi-db-preview" : "animeishi-db";
  // -y: リモート実行時に wrangler が出す確認プロンプトを自動承認する。
  // 本番への確認は Taskfile 側の prompt: が担う（reports.sh と同じ設計）。
  const d1Target = args.local
    ? ["--local"]
    : ["--remote", "--env", args.env, "-y"];

  // wrangler は apps/api にだけ入っているため、どこから呼んでも
  // apps/api で実行する（reports.sh と同じ考え方）。
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
