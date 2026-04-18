import noDirectDb from "./eslint-rules/no-direct-db.js";
import tseslint from 'typescript-eslint';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...tseslint.configs.recommended,
  {
    plugins: {
      "animeishi-local": {
        rules: {
          "no-direct-db": noDirectDb,
        },
      },
    },
    rules: {
      "animeishi-local/no-direct-db": "error",
    },
    files: ["src/**/*.ts"],
  },
];
