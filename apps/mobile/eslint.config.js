import tseslint from 'typescript-eslint';

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...tseslint.configs.recommended,
  {
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "store/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
  },
];
