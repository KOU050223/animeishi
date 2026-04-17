/**
 * ESLint カスタムルール `no-direct-db` のユニットテスト
 *
 * Vitest + ESLint の RuleTester を使って、
 * 正常検出ケース・回避ケースを網羅的に確認する。
 */

import { RuleTester } from "eslint";
import rule from "../eslint-rules/no-direct-db.js";

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

// vitest v4 では test() 内での describe() 呼び出しが禁止されたため、
// RuleTester.run() はトップレベルで直接呼び出す
ruleTester.run("no-direct-db", rule, {
  valid: [
    // リポジトリ層内は許可（filename で制御）
    {
      code: `const db = createDb(env.DB); db.insert(users).values({});`,
      filename: "src/repository/profileRepo.ts",
    },
    // createDb() 由来でない変数への操作は対象外
    {
      code: `const client = getClient(); client.insert(users).values({});`,
      filename: "src/routes/health.ts",
    },
    // 許可されていないメソッド名（select は禁止対象外）
    {
      code: `const db = createDb(env.DB); db.select().from(users);`,
      filename: "src/routes/health.ts",
    },
  ],

  invalid: [
    // ドット記法: db.insert()
    {
      code: `const db = createDb(env.DB); db.insert(users).values({});`,
      filename: "src/routes/health.ts",
      errors: [{ messageId: "noDirectDb" }],
    },
    // ドット記法: db.update()
    {
      code: `const db = createDb(env.DB); db.update(users).set({});`,
      filename: "src/routes/health.ts",
      errors: [{ messageId: "noDirectDb" }],
    },
    // ドット記法: db.delete()
    {
      code: `const db = createDb(env.DB); db.delete(users).where();`,
      filename: "src/routes/health.ts",
      errors: [{ messageId: "noDirectDb" }],
    },
    // ブラケット記法（文字列リテラル）: db["insert"]()
    {
      code: `const db = createDb(env.DB); db["insert"](users).values({});`,
      filename: "src/routes/health.ts",
      errors: [{ messageId: "noDirectDb" }],
    },
    // ブラケット記法: db["update"]()
    {
      code: `const db = createDb(env.DB); db["update"](users).set({});`,
      filename: "src/routes/health.ts",
      errors: [{ messageId: "noDirectDb" }],
    },
    // ブラケット記法: db["delete"]()
    {
      code: `const db = createDb(env.DB); db["delete"](users).where();`,
      filename: "src/routes/health.ts",
      errors: [{ messageId: "noDirectDb" }],
    },
    // エイリアス（const x = db）経由
    {
      code: `const db = createDb(env.DB); const x = db; x.insert(users).values({});`,
      filename: "src/routes/health.ts",
      errors: [{ messageId: "noDirectDb" }],
    },
    // 代入エイリアス（x = db）経由
    {
      code: `let db; const tmp = createDb(env.DB); let x; x = tmp; x.update(users).set({});`,
      filename: "src/routes/health.ts",
      errors: [{ messageId: "noDirectDb" }],
    },
    // AssignmentExpression で createDb() を代入するパターン
    {
      code: `let db; db = createDb(env.DB); db.insert(users).values({});`,
      filename: "src/routes/health.ts",
      errors: [{ messageId: "noDirectDb" }],
    },
  ],
});
