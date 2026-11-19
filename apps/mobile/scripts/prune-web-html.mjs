import { access, readdir, unlink } from "node:fs/promises";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "../dist");
const publicHtml = new Set([
  "index.html",
  "welcome.html",
  "privacy.html",
  "terms.html",
  "support.html",
]);

async function prune(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await prune(fullPath);
    } else if (
      entry.isFile() &&
      entry.name.endsWith(".html") &&
      !publicHtml.has(path.relative(dist, fullPath))
    ) {
      await unlink(fullPath);
    }
  }
}

await prune(dist);
for (const file of publicHtml) {
  await access(path.join(dist, file));
}
