import { describe, it, expect } from "vitest";
import { parseAllowedOrigins, resolveAllowedOrigin } from "@/cors";

describe("parseAllowedOrigins", () => {
  it("カンマ区切りを分割し、空白と空要素を除去する", () => {
    expect(
      parseAllowedOrigins(" https://a.example , ,https://b.example "),
    ).toEqual(["https://a.example", "https://b.example"]);
  });

  it("undefined / 空文字は空配列になる", () => {
    expect(parseAllowedOrigins(undefined)).toEqual([]);
    expect(parseAllowedOrigins("")).toEqual([]);
  });
});

describe("resolveAllowedOrigin", () => {
  const prod = "https://animeishi-web-production.uozumi05.workers.dev";
  const preview =
    "https://abc123-animeishi-web-production.uozumi05.workers.dev";
  const custom = "https://animeishi.uomi.dev";
  const local = "http://localhost:8081";

  it("allowlist が空なら全オリジンを許可する（開発用）", () => {
    expect(resolveAllowedOrigin(prod, [])).toBe(prod);
    expect(resolveAllowedOrigin("https://evil.example", [])).toBe(
      "https://evil.example",
    );
  });

  it("完全一致するオリジンを許可する", () => {
    const allowlist = [prod, custom, local];
    expect(resolveAllowedOrigin(prod, allowlist)).toBe(prod);
    expect(resolveAllowedOrigin(custom, allowlist)).toBe(custom);
    expect(resolveAllowedOrigin(local, allowlist)).toBe(local);
  });

  it("一致しないオリジンは null を返す", () => {
    const allowlist = [prod, custom];
    expect(resolveAllowedOrigin("https://evil.example", allowlist)).toBeNull();
    // ポート違いの localhost は別オリジン
    expect(resolveAllowedOrigin("http://localhost:3000", [local])).toBeNull();
  });

  it("ワイルドカード（*-...）はサフィックス一致でプレビュー URL を許可する", () => {
    const allowlist = ["*-animeishi-web-production.uozumi05.workers.dev"];
    expect(resolveAllowedOrigin(preview, allowlist)).toBe(preview);
  });

  it("ワイルドカードのサフィックスに一致しないオリジンは弾く", () => {
    const allowlist = ["*-animeishi-web-production.uozumi05.workers.dev"];
    // 別アカウントのサブドメインを装ったオリジン
    expect(
      resolveAllowedOrigin(
        "https://abc-animeishi-web-production.evil.workers.dev",
        allowlist,
      ),
    ).toBeNull();
  });

  it("完全一致とワイルドカードを混在できる", () => {
    const allowlist = [
      custom,
      local,
      "*-animeishi-web-production.uozumi05.workers.dev",
    ];
    expect(resolveAllowedOrigin(custom, allowlist)).toBe(custom);
    expect(resolveAllowedOrigin(preview, allowlist)).toBe(preview);
    expect(resolveAllowedOrigin("https://evil.example", allowlist)).toBeNull();
  });
});
