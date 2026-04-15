import noDirectDb from "./eslint-rules/no-direct-db.js";

/** @type {import("eslint").Linter.Config[]} */
export default [
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
