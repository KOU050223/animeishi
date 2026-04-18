import tseslint from 'typescript-eslint';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "__tests__/**/*.ts"],
  },
];
