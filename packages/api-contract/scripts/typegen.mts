import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(root, "../..");
const generatedDir = join(root, "generated");
const workDir = join(generatedDir, `.typegen.${process.pid}`);
const generatedFile = join(generatedDir, "rpcSchema.d.ts");
const temporaryFile = join(generatedDir, `.rpcSchema.${process.pid}.tmp`);

// tsc は依存した API ソースの d.ts も outDir に出す。消費するのは
// rpcSchema.d.ts だけなので、実行ごとの .typegen.<pid> に出して必要なファイルだけを
// 移す。失敗したときに既存の rpcSchema.d.ts を壊さないよう、コピー先は
// 一時ファイルにしてから rename で差し替える。
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });

try {
  execFileSync(
    process.execPath,
    [
      // .bin/tsc は Windows では直接実行できない shim なので、Node からエントリを起動する。
      join(workspaceRoot, "node_modules/@typescript/native/bin/tsc"),
      // typegen では型エラーを検査しない。API の型エラーは API の typecheck が
      // 検出し、ここで失敗させると prepare 経由の vp install まで止まるため。
      "--noCheck",
      "-p",
      join(workspaceRoot, "apps/api/tsconfig.rpc.json"),
      "--outDir",
      workDir,
    ],
    { stdio: "inherit" },
  );
  copyFileSync(join(workDir, "rpcSchema.d.ts"), temporaryFile);
  renameSync(temporaryFile, generatedFile);
  console.log("generated/rpcSchema.d.ts を更新しました");
} finally {
  rmSync(temporaryFile, { force: true });
  rmSync(workDir, { recursive: true, force: true });
}
