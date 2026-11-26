import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const API_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(API_DIR, "../..");
const DRIZZLE_KIT_BIN = join(REPO_ROOT, "node_modules/drizzle-kit/bin.cjs");

// 実際の .wrangler を移動すると並列実行中のテストや開発サーバと競合するため、
// CLI 実行用のコピーを temp ディレクトリに作る。
function copyApiFixture(fixtureDir: string) {
  mkdirSync(join(fixtureDir, "scripts"), { recursive: true });
  for (const file of ["drizzle.config.ts", "wrangler.toml", "tsconfig.json"]) {
    cpSync(join(API_DIR, file), join(fixtureDir, file));
  }
  cpSync(
    join(API_DIR, "scripts/local-d1-sqlite.mjs"),
    join(fixtureDir, "scripts/local-d1-sqlite.mjs"),
  );
  cpSync(join(API_DIR, "src"), join(fixtureDir, "src"), { recursive: true });
  cpSync(join(API_DIR, "migrations"), join(fixtureDir, "migrations"), {
    recursive: true,
  });
  symlinkSync(
    join(REPO_ROOT, "node_modules"),
    join(fixtureDir, "node_modules"),
    "dir",
  );
}

function runDrizzleKit(cwd: string, command: "generate" | "studio") {
  return spawnSync(process.execPath, [DRIZZLE_KIT_BIN, command], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
    timeout: 15_000,
  });
}

describe("drizzle.config.ts", () => {
  let fixtureDir: string;

  beforeAll(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "animeishi-drizzle-config-"));
    copyApiFixture(fixtureDir);
  });

  afterAll(() => {
    rmSync(fixtureDir, { recursive: true, force: true });
  });

  it("ローカル D1 が無くても generate がスキーマ差分を確認できる", () => {
    const result = runDrizzleKit(fixtureDir, "generate");
    const output = `${result.stdout}${result.stderr}`;

    if (result.error || result.status !== 0) {
      throw new Error(`drizzle-kit generate failed:\n${output}`);
    }
    expect(output).toContain("No schema changes, nothing to migrate");
  });

  it("ローカル D1 が無いとき studio は作成方法を案内して終了する", () => {
    const result = runDrizzleKit(fixtureDir, "studio");
    const output = `${result.stdout}${result.stderr}`;

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(output).toContain("ローカルD1のSQLiteファイルが見つかりません");
    expect(output).toContain("vp run @animeishi/api#db:migrate:local");
  });
});
