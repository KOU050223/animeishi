#!/usr/bin/env node
// 総選挙（issue #438）を frontmatter 付き Markdown から D1 に投入する
// 運営用スクリプト。通常は Taskfile 経由で実行する:
//   pnpm task elections:publish -- <選挙.md のパス>          # 本番（確認プロンプト付き）
//   pnpm task elections:publish:preview -- <選挙.md のパス>  # プレビュー
//   pnpm task elections:publish:local -- <選挙.md のパス>    # ローカル D1
//
// 直接実行:
//   node scripts/publish-election.mjs [--env production|preview | --local] <選挙.md のパス>
//
// Markdown ファイルの形式:
//   ---
//   slug: megane-2026                # 必須。[a-z0-9][a-z0-9-]*。総選挙詳細の URL になる
//   title: みんなが推す眼鏡キャラ総選挙 # 必須
//   cover_image_url: https://...     # 省略可。総選挙のカードと詳細上部に出す画像
//   starts_at: 2026-11-10T10:00:00+09:00   # 必須。投票受付の開始日時（ISO 8601）
//   ends_at: 2026-11-20T18:00:00+09:00     # 必須。投票受付の終了日時。starts_at より後
//   published_at: 2026-11-01T09:00:00+09:00  # 必須。画面への公開開始日時
//   unpublished_at: 2026-12-01T00:00:00+09:00 # 省略可。画面への公開終了日時。無いと終了期限なし
//   candidates:                      # 必須。候補リスト（2 件以上、並び順が表示順）
//     - kind: character              #   character | work のどちらか
//       annict_id: 1234              #   Annict の ID（正の整数）
//       name: 山田太郎               #   表示名（キャラ名や作品タイトル）
//       image_url: https://...       #   省略可。候補に出す画像
//     - kind: work
//       annict_id: 5678
//       name: 作品タイトル
//   ---
//   本文 Markdown                     # 省略可。詳細画面に出す説明文
//
// 同一の (kind, annict_id) を candidates に 2 回書くとエラーになる。
// 同じ slug の総選挙があれば上書きする（upsert）。created_at は初回投入時を
// 保持する。frontmatter から消した候補は削除される（その候補への票も消える）。
// 終了した総選挙を画面から引っ込めるだけなら unpublished_at を過去日時にして
// 再投入する。結果の集計は `pnpm task elections:results -- --slug <slug>`。

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
import { buildElectionRows } from "./lib/election-content.mjs";

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
      throw new Error(`総選挙ファイルは 1 つだけ指定してください: ${arg}`);
    }
  }
  return { env, local, file };
}

function help() {
  console.log(
    "使い方: node scripts/publish-election.mjs [--env production|preview | --local] <選挙.md のパス>\n" +
      "frontmatter の項目はこのファイル冒頭のコメントを参照。",
  );
}

function buildSql(attributes, body) {
  const { election, candidates } = buildElectionRows(attributes, body);
  const now = Math.floor(Date.now() / 1000);
  const statements = [
    buildUpsertSql({
      table: "elections",
      conflictColumns: ["slug"],
      // created_at は再投入で上書きしない
      keepOnUpdate: ["created_at"],
      row: {
        ...election,
        created_at: now,
        updated_at: now,
      },
    }),
  ];

  // 候補は (election_slug, kind, annict_id) で upsert。id・created_at を
  // 保持するため、その組は UPDATE から外す（keepOnUpdate）。重複候補は
  // buildElectionRows が弾いている。
  for (const candidate of candidates) {
    statements.push(
      buildUpsertSql({
        table: "election_candidates",
        conflictColumns: ["election_slug", "kind", "annict_id"],
        keepOnUpdate: ["created_at"],
        row: {
          election_slug: election.slug,
          ...candidate,
          created_at: now,
          updated_at: now,
        },
      }),
    );
  }

  // frontmatter から消えた候補を削除する。election_votes は
  // ON DELETE CASCADE で一緒に消える（候補削除はその候補の票も無効にする
  // 運用なので）。
  const kept = candidates
    .map((c) => `(${sqlLiteral(c.kind)}, ${c.annict_id})`)
    .join(", ");
  statements.push(
    `DELETE FROM election_candidates WHERE election_slug = ${sqlLiteral(election.slug)} AND (kind, annict_id) NOT IN (${kept});`,
  );

  statements.push(
    `SELECT slug, title, datetime(starts_at, 'unixepoch') AS starts_at, datetime(ends_at, 'unixepoch') AS ends_at FROM elections WHERE slug = ${sqlLiteral(election.slug)};`,
    `SELECT kind, annict_id, name, position FROM election_candidates WHERE election_slug = ${sqlLiteral(election.slug)} ORDER BY position;`,
  );
  return statements.join("\n");
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
  const sql = buildSql(attributes, body);

  const tmpFile = join(
    tmpdir(),
    `animeishi-election-${process.pid}-${Date.now()}.sql`,
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
