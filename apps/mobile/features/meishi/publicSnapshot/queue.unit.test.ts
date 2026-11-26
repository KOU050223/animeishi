import { describe, expect, it } from "vitest";
import { enqueueSnapshotOperation } from "./queue";

describe("公開名刺スナップショットの操作順", () => {
  it("先の送信が終わってから次の削除を実行する", async () => {
    const calls: string[] = [];
    let finishFirst = () => {};
    const first = enqueueSnapshotOperation(async () => {
      calls.push("publish-start");
      await new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
      calls.push("publish-end");
    });
    const second = enqueueSnapshotOperation(async () => {
      calls.push("clear");
    });
    await Promise.resolve();
    expect(calls).toEqual(["publish-start"]);
    finishFirst();
    await Promise.all([first, second]);
    expect(calls).toEqual(["publish-start", "publish-end", "clear"]);
  });

  it("失敗した送信の後も次の操作を実行する", async () => {
    await expect(
      enqueueSnapshotOperation(async () => {
        throw new Error("upload failed");
      }),
    ).rejects.toThrow("upload failed");
    let ran = false;
    await enqueueSnapshotOperation(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
