import { describe, expect, it } from "vitest";
import {
  decideDanimeImport,
  isDanimeImportProtectedState,
} from "./importDecision";

describe("decideDanimeImport", () => {
  it("未登録（null）は WATCHED / WATCHING どちらも登録できる", () => {
    expect(decideDanimeImport("WATCHED", null)).toBe("apply");
    expect(decideDanimeImport("WATCHING", null)).toBe("apply");
  });

  it("NO_STATE は未登録扱いで登録できる", () => {
    expect(decideDanimeImport("WATCHING", "NO_STATE")).toBe("apply");
  });

  it("視聴予定（WANNA_WATCH）は取り込みで進めてよい", () => {
    expect(decideDanimeImport("WATCHED", "WANNA_WATCH")).toBe("apply");
    expect(decideDanimeImport("WATCHING", "WANNA_WATCH")).toBe("apply");
  });

  it("視聴中（WATCHING）は視聴済への前進だけ許可する", () => {
    expect(decideDanimeImport("WATCHED", "WATCHING")).toBe("apply");
  });

  it.each(["WATCHED", "ON_HOLD", "STOP_WATCHING"] as const)(
    "%s の作品は WATCHING 取り込みで変更しない",
    (currentState) => {
      expect(decideDanimeImport("WATCHING", currentState)).toBe(
        "protected_state",
      );
    },
  );

  it("一時停止・断念の作品は WATCHED 取り込みでも変更しない", () => {
    expect(decideDanimeImport("WATCHED", "ON_HOLD")).toBe("protected_state");
    expect(decideDanimeImport("WATCHED", "STOP_WATCHING")).toBe(
      "protected_state",
    );
    // WATCHED → WATCHED は変更が無いので same_state 側に倒れる。
  });

  it.each(["WATCHING", "WATCHED", "ON_HOLD", "STOP_WATCHING"] as const)(
    "現在と同じステータスへの登録は same_state で何もしない（%s）",
    (state) => {
      expect(decideDanimeImport(state, state)).toBe("same_state");
    },
  );

  it("現状不明（undefined）では WATCHING 登録だけ保留する", () => {
    expect(decideDanimeImport("WATCHING", undefined)).toBe(
      "current_state_unknown",
    );
    // WATCHED 登録は既存状態を降格させないので現状不明でも通す。
    expect(decideDanimeImport("WATCHED", undefined)).toBe("apply");
  });
});

describe("isDanimeImportProtectedState", () => {
  it("視聴済・一時停止・断念だけが true", () => {
    expect(isDanimeImportProtectedState("WATCHED")).toBe(true);
    expect(isDanimeImportProtectedState("ON_HOLD")).toBe(true);
    expect(isDanimeImportProtectedState("STOP_WATCHING")).toBe(true);
    expect(isDanimeImportProtectedState("WATCHING")).toBe(false);
    expect(isDanimeImportProtectedState("WANNA_WATCH")).toBe(false);
    expect(isDanimeImportProtectedState("NO_STATE")).toBe(false);
  });
});
