import { describe, expect, it } from "vitest";
import { apiErrorMessage, apiErrorMessageKey } from "@/lib/apiErrorMessages";

// code → 表示文言の対応表（issue #838）。vitest 環境では i18next が未初期化
// なので t() はキー（ja 文言）をそのまま返す。ここでは対応表の引き方だけを見る。
describe("apiErrorMessageKey", () => {
  it("既知の code は対応する翻訳キーを返す", () => {
    expect(apiErrorMessageKey("rate_limited")).toBe(
      "リクエストが多すぎます。しばらくしてからお試しください",
    );
    expect(apiErrorMessageKey("generation_limit")).toBe(
      "試行回数が上限に達しました。しばらくしてからお試しください",
    );
  });

  it("未知の code と undefined は undefined を返す（汎用文言へフォールバック）", () => {
    expect(apiErrorMessageKey("unknown_future_code")).toBeUndefined();
    expect(apiErrorMessageKey(undefined)).toBeUndefined();
  });
});

describe("apiErrorMessage", () => {
  it("既知の code は文言を返し、未知の code は undefined を返す", () => {
    expect(apiErrorMessage("duplicate_target")).toBe(
      "同じユーザーへの通報は24時間に1回までです",
    );
    expect(apiErrorMessage("unknown_future_code")).toBeUndefined();
  });
});
