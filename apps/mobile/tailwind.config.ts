import { createRequire } from "node:module";
import type { Config } from "tailwindcss";

const require = createRequire(import.meta.url);
const nativewindPreset = require("nativewind/preset");

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  darkMode: "class",
  presets: [nativewindPreset],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
