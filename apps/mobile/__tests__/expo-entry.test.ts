import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(__dirname, "..");

describe("Expo entrypoint configuration", () => {
  test("loads react-native-gesture-handler before expo-router entry", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
    ) as { main?: string };
    expect(pkg.main).toBe("index.js");
    const entry = pkg.main as string;

    const source = fs.readFileSync(path.join(rootDir, entry), "utf8");
    const executableLines = source
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("//"));

    expect(executableLines[0]).toBe('import "react-native-gesture-handler";');
    expect(executableLines[1]).toBe('import "expo-router/entry";');
  });
});
