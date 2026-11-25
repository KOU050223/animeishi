import { describe, expect, it } from "vitest";
import { routes } from "@/index";

// 全ルートを OpenAPI（createRoute）にそろえる方針（issue #735）。
// JSON を返さないルートだけをここに列挙して /doc から外す。
const NON_JSON_ROUTES = [
  // 共有ページの HTML
  /^GET \/share\//,
  // 画像バイナリの配信
  /^GET \/images\//,
  /^GET \/me\/profile\/avatar\/\*$/,
  /^GET \/me\/meishi-assets\/\*$/,
  // Apple Wallet の pkpass
  /^GET \/me\/pass\/meishi\.pkpass$/,
  // OpenAPI ドキュメント自体
  /^GET \/doc$/,
  /^GET \/ui$/,
];

const ALLOWLIST = [...NON_JSON_ROUTES];

// Hono のパス（`:id`・`:id{[0-9]+}`）を OpenAPI のパス（`{id}`）にそろえる。
function toOpenApiPath(path: string): string {
  return path.replace(/:(\w+)(\{[^}]*\})?/g, "{$1}");
}

async function documentedOperations(): Promise<Set<string>> {
  const res = await routes.request("/doc", {}, {});
  const doc = (await res.json()) as {
    paths: Record<string, Record<string, unknown>>;
  };
  return new Set(
    Object.entries(doc.paths).flatMap(([path, operations]) =>
      Object.keys(operations).map(
        (method) => `${method.toUpperCase()} ${path}`,
      ),
    ),
  );
}

function registeredOperations(): string[] {
  // ミドルウェア（app.use）は method が ALL で登録される。
  const operations = routes.routes
    .filter((route) => route.method !== "ALL")
    .map((route) => `${route.method} ${toOpenApiPath(route.path)}`);
  return [...new Set(operations)];
}

describe("OpenAPI ドキュメントの網羅", () => {
  it("許可リスト以外の全ルートが /doc に載っている", async () => {
    const documented = await documentedOperations();

    const undocumented = registeredOperations().filter(
      (operation) =>
        !documented.has(operation) &&
        !ALLOWLIST.some((pattern) => pattern.test(operation)),
    );

    expect(undocumented).toEqual([]);
  });

  it("許可リストの各項目が実在するルートに一致する", () => {
    const operations = registeredOperations();

    const stale = ALLOWLIST.filter(
      (pattern) => !operations.some((operation) => pattern.test(operation)),
    );

    expect(stale).toEqual([]);
  });
});
