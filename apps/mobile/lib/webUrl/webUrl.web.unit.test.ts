// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// webUrl はモジュール評価時にベース URL を解決するため、
// env / window.location を変えた状態で毎回 import し直して検証する。
async function importWebUrl() {
  vi.resetModules();
  return (await import("@/lib/webUrl/webUrl.web")).webUrl;
}

describe("webUrl (web)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("EXPO_PUBLIC_WEB_URL があればそれを使う", async () => {
    vi.stubEnv("EXPO_PUBLIC_WEB_URL", "https://animeishi.uomi.dev/");
    expect(await importWebUrl()).toBe("https://animeishi.uomi.dev");
  });

  it("未設定なら実行中のオリジンを使う（PR プレビュー等）", async () => {
    // 開発者のローカル環境変数に左右されないよう明示的に未設定にする
    vi.stubEnv("EXPO_PUBLIC_WEB_URL", undefined);
    expect(await importWebUrl()).toBe(window.location.origin);
  });
});
