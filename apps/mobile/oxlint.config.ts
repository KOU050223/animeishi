import { defineConfig } from "oxlint";
import native from "oxlint-config-universe/native";

export default defineConfig({
  extends: [native],
  categories: {
    correctness: "error",
  },
  rules: {
    curly: "off",
    "no-void": "off",
    "typescript/array-type": "off",
  },
});
