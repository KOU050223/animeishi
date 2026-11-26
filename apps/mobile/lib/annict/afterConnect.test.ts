import { QueryObserver } from "@tanstack/react-query";
import { createTestQueryClient } from "@/test-utils/queryClient";
import { refetchWorksAfterAnnictConnect } from "./afterConnect";

function makeClient() {
  return createTestQueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("refetchWorksAfterAnnictConnect（issue #561）", () => {
  it("取得中の作品詳細をキャンセルし、共用トークンの応答を残さず本人の状態で取り直す", async () => {
    const client = makeClient();
    const queryKey = ["works", "detail", "user_1", 1];
    let resolveShared: (v: { state: string | null }) => void = () => {};
    const queryFn = jest
      .fn()
      // 未連携のあいだに始まった取得（共用トークン。state は常に null）
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveShared = resolve;
          }),
      )
      .mockResolvedValue({ state: "WATCHING" });
    const observer = new QueryObserver(client, { queryKey, queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await flush();

    await refetchWorksAfterAnnictConnect(client);
    resolveShared({ state: null });
    await flush();

    expect(client.getQueryData(queryKey)).toEqual({ state: "WATCHING" });
    unsubscribe();
  });

  it("失敗したままのクエリ（共用トークン失効など）を取り直す", async () => {
    const client = makeClient();
    const queryKey = ["anime-list", "title", "進撃"];
    const queryFn = jest
      .fn()
      .mockRejectedValueOnce(new Error("annict_shared_token_unavailable"))
      .mockResolvedValue(["作品"]);
    const observer = new QueryObserver(client, { queryKey, queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await flush();
    expect(client.getQueryState(queryKey)?.status).toBe("error");

    await refetchWorksAfterAnnictConnect(client);

    expect(client.getQueryData(queryKey)).toEqual(["作品"]);
    unsubscribe();
  });

  it("成功済みの作品情報以外のクエリは取り直さない", async () => {
    const client = makeClient();
    const queryKey = ["anime-list", "season", "2026-autumn"];
    const queryFn = jest.fn().mockResolvedValue(["作品"]);
    const observer = new QueryObserver(client, { queryKey, queryFn });
    const unsubscribe = observer.subscribe(() => {});
    await flush();

    await refetchWorksAfterAnnictConnect(client);

    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
