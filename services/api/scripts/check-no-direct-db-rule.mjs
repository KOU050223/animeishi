import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "animeishi-no-direct-db-"));
const fixturePath = join(tempDir, "direct-db.fixture.ts");

writeFileSync(
  fixturePath,
  `
function createDb() {
  return {
    insert() {
      return {
        values() {},
      };
    },
  };
}

const users = {};
const db = createDb();
db.insert(users).values({});
`,
);

try {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(
    pnpmCommand,
    ["exec", "oxlint", fixturePath, "--config", ".oxlintrc.json"],
    {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    },
  );

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  if (result.error) {
    throw result.error;
  }

  const ruleWasReported =
    output.includes("animeishi-local/no-direct-db") ||
    output.includes("animeishi-local(no-direct-db)");

  if (result.status === 0 || !ruleWasReported) {
    console.error("animeishi-local/no-direct-db rule was not enforced.");
    console.error(output);
    process.exit(1);
  }
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
