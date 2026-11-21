import { describe, expect, it } from "vitest";
import {
  approachProgress,
  initialNearbySessionState,
  nearbySessionReducer,
  selectTargetPeer,
  type NearbySessionEvent,
  type NearbySessionState,
} from "./exchangeSession";

function run(...events: NearbySessionEvent[]): NearbySessionState {
  return events.reduce(nearbySessionReducer, initialNearbySessionState);
}

const found = (peerId: string, displayName = peerId): NearbySessionEvent => ({
  type: "peerFound",
  peerId,
  displayName,
});
const distance = (
  peerId: string,
  meters: number | null,
): NearbySessionEvent => ({
  type: "distance",
  peerId,
  meters,
});

describe("nearbySessionReducer", () => {
  it("10cm 以内に入った相手との入れ替わりを始める", () => {
    const state = run(
      found("a", "ハル"),
      distance("a", 0.5),
      distance("a", 0.09),
    );
    expect(state.exchange).toEqual({
      kind: "swapping",
      attempt: 1,
      peerId: "a",
      displayName: "ハル",
      sent: false,
      received: null,
    });
  });

  it("10cm より遠いあいだは入れ替わりを始めない", () => {
    const state = run(found("a"), distance("a", 0.2), distance("a", 0.11));
    expect(state.exchange).toEqual({ kind: "idle" });
  });

  it("相手が先に送ってきたら、こちらも同じ相手との入れ替わりを始めて送り返す", () => {
    const state = run(found("a"), distance("a", 0.15), {
      type: "payload",
      peerId: "a",
      payload: "https://example.com/user/x?qt=t",
    });
    expect(state.exchange).toMatchObject({
      kind: "swapping",
      peerId: "a",
      sent: false,
      received: "https://example.com/user/x?qt=t",
    });
  });

  it("こちらで近くにいると測れていない相手から届いたデータには応じない", () => {
    const payload = { type: "payload" as const, peerId: "a", payload: "x" };
    expect(run(found("a"), payload).exchange).toEqual({ kind: "idle" });
    expect(run(found("a"), distance("a", 0.5), payload).exchange).toEqual({
      kind: "idle",
    });
  });

  it("入れ替わり中に別の相手から届いたデータは受け取らない", () => {
    const state = run(found("a"), found("b"), distance("a", 0.05), {
      type: "payload",
      peerId: "b",
      payload: "x",
    });
    expect(state.exchange).toMatchObject({ peerId: "a", received: null });
  });

  it("相手のデータが届く前に切れたら入れ替わりをやめる", () => {
    const state = run(found("a"), distance("a", 0.05), {
      type: "peerLost",
      peerId: "a",
    });
    expect(state.exchange).toEqual({ kind: "idle" });
  });

  it("相手のデータが届いた後に切れても入れ替わりを続ける", () => {
    const state = run(
      found("a"),
      distance("a", 0.05),
      { type: "payload", peerId: "a", payload: "x" },
      { type: "peerLost", peerId: "a" },
    );
    expect(state.exchange).toMatchObject({ kind: "swapping", received: "x" });
  });

  it("成立した相手には触れ続けても再交換しない", () => {
    const state = run(
      found("a"),
      distance("a", 0.05),
      { type: "payload", peerId: "a", payload: "x" },
      { type: "finish", exchanged: true },
      distance("a", 0.04),
    );
    expect(state.exchange).toEqual({ kind: "idle" });
    expect(state.exchangedPeerIds).toEqual(["a"]);
  });

  it("成立しなかった相手とは、10cm の外へ離れてから近づけ直すともう一度交換できる", () => {
    const failed = [
      found("a"),
      distance("a", 0.05),
      { type: "finish", exchanged: false } as const,
    ];
    // 触れたままでは再開しない（失敗と再開を繰り返さない）。
    expect(run(...failed, distance("a", 0.05)).exchange).toEqual({
      kind: "idle",
    });
    expect(
      run(...failed, distance("a", 0.3), distance("a", 0.05)).exchange,
    ).toMatchObject({ kind: "swapping", peerId: "a" });
  });

  it("時間切れは受信待ちの同じ相手にだけ効き、受け取り済みのデータは捨てない", () => {
    const waiting = run(found("a"), distance("a", 0.05), {
      type: "timeout",
      attempt: 1,
    });
    expect(waiting.exchange).toEqual({ kind: "idle" });
    expect(waiting.heldPeerIds).toEqual(["a"]);

    const received = run(
      found("a"),
      distance("a", 0.05),
      { type: "payload", peerId: "a", payload: "x" },
      { type: "timeout", attempt: 1 },
    );
    expect(received.exchange).toMatchObject({ received: "x" });
  });

  it("前の入れ替わりの時間切れは、同じ相手との新しい入れ替わりを終わらせない", () => {
    const state = run(
      found("a"),
      distance("a", 0.05),
      { type: "peerLost", peerId: "a" },
      found("a"),
      distance("a", 0.05),
      { type: "timeout", attempt: 1 },
    );
    expect(state.exchange).toMatchObject({ kind: "swapping", attempt: 2 });
  });

  it("保留中の相手から遅れて届いたデータでは再開しない", () => {
    const state = run(
      found("a"),
      distance("a", 0.05),
      { type: "timeout", attempt: 1 },
      { type: "payload", peerId: "a", payload: "x" },
    );
    expect(state.exchange).toEqual({ kind: "idle" });
  });

  it("探索を止めたら見つけていた相手を捨て、受け取り済みの入れ替わりだけ残す", () => {
    const waiting = run(found("a"), distance("a", 0.05), { type: "stopped" });
    expect(waiting.peers).toEqual({});
    expect(waiting.exchange).toEqual({ kind: "idle" });

    const received = run(
      found("a"),
      distance("a", 0.05),
      { type: "payload", peerId: "a", payload: "x" },
      { type: "stopped" },
    );
    expect(received.exchange).toMatchObject({
      kind: "swapping",
      received: "x",
    });
  });

  it("許可の拒否は retry で探索中に戻る", () => {
    const state = run(
      { type: "error", code: "local_network_denied" },
      { type: "retry" },
    );
    expect(state.status).toBe("active");
    expect(
      run({ type: "capability", uwb: false }, { type: "retry" }).status,
    ).toBe("unsupported");
  });

  it("許可の拒否は denied、UWB 非対応は unsupported にする", () => {
    expect(run({ type: "error", code: "local_network_denied" }).status).toBe(
      "denied",
    );
    expect(run({ type: "error", code: "ni_permission_denied" }).status).toBe(
      "denied",
    );
    expect(run({ type: "capability", uwb: false }).status).toBe("unsupported");
    expect(run({ type: "error", code: "connection_failed" }).status).toBe(
      "active",
    );
  });
});

describe("selectTargetPeer", () => {
  it("距離が測れている相手のうち最も近い人を選ぶ", () => {
    const state = run(
      found("a"),
      found("b"),
      found("c"),
      distance("a", 0.8),
      distance("b", 0.3),
    );
    expect(selectTargetPeer(state)?.peerId).toBe("b");
  });

  it("誰も測れていなければ見つかった相手を選び、交換済みの相手は除く", () => {
    const state = run(found("a"), found("b"), distance("a", 0.05), {
      type: "finish",
      exchanged: true,
    });
    expect(selectTargetPeer(state)?.peerId).toBe("b");
  });
});

describe("approachProgress", () => {
  it("1m で 0、10cm 以内で 1 になる", () => {
    expect(approachProgress(1)).toBe(0);
    expect(approachProgress(2)).toBe(0);
    expect(approachProgress(0.1)).toBe(1);
    expect(approachProgress(0.05)).toBe(1);
    expect(approachProgress(null)).toBe(0);
    expect(approachProgress(0.5)).toBeCloseTo(0.3, 1);
  });
});
