// 照合失敗時のユーザー向け文言。API のエラー JSON（{error, code}）を
// そのまま出さず、code ごとの案内に変換する（issue #219）。
import { describe, it, expect } from "vitest";
import { ApiRequestError } from "@/lib/apiError";
import { danimeMatchErrorMessage } from "./matchErrorMessage";

describe("danimeMatchErrorMessage", () => {
  it("annict_token_invalid / annict_token_required は Annict 再連携を促す", () => {
    for (const code of ["annict_token_invalid", "annict_token_required"]) {
      const message = danimeMatchErrorMessage(
        new ApiRequestError(401, "Annict とのマッチングに失敗しました", code),
      );
      expect(message).toBe(
        "Annict 連携が無効になっています。設定から連携し直してください。",
      );
    }
  });

  it("annict_upstream は時間をおいて再試行を促す", () => {
    const message = danimeMatchErrorMessage(
      new ApiRequestError(
        502,
        "Annict とのマッチングに失敗しました",
        "annict_upstream",
      ),
    );
    expect(message).toBe(
      "Annict との通信に失敗しました。時間をおいて再度お試しください。",
    );
  });

  it("internal_error はサーバーエラーの文言を返す", () => {
    const message = danimeMatchErrorMessage(
      new ApiRequestError(
        500,
        "Annict とのマッチングに失敗しました",
        "internal_error",
      ),
    );
    expect(message).toBe(
      "サーバーエラーが発生しました。時間をおいて再度お試しください。",
    );
  });

  it("code が無い・未知の API エラーは汎用文言を返す", () => {
    expect(
      danimeMatchErrorMessage(new ApiRequestError(400, "バリデーションエラー")),
    ).toBe("照合に失敗しました。時間をおいて再度お試しください。");
    expect(
      danimeMatchErrorMessage(new ApiRequestError(502, "失敗", "unknown_code")),
    ).toBe("照合に失敗しました。時間をおいて再度お試しください。");
  });

  it("fetch の reject（TypeError）は接続確認を促す", () => {
    expect(danimeMatchErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "通信に失敗しました。ネットワーク接続を確認して再度お試しください。",
    );
  });

  it("それ以外の Error はそのメッセージを返し、Error でなければ汎用文言を返す", () => {
    expect(
      danimeMatchErrorMessage(new Error("照合対象の作品がありません")),
    ).toBe("照合対象の作品がありません");
    expect(danimeMatchErrorMessage("unknown")).toBe(
      "照合に失敗しました。時間をおいて再度お試しください。",
    );
  });
});
