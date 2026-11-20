import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  enqueueExchange,
  flushExchangeQueue,
  readExchangeQueue,
  type NewExchangeQueueItem,
} from "@/lib/exchangeQueue";

const USER_A = "user_partner_a";
const USER_B = "user_partner_b";

const item = (
  friendId: string,
  extra: Partial<NewExchangeQueueItem> = {},
): NewExchangeQueueItem => ({
  friendId,
  qrToken: `qt-${friendId}`,
  offlineToken: undefined,
  miniMeishi: { username: `name-${friendId}` },
  scannedAt: "2026-11-21T10:00:00.000Z",
  ...extra,
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("enqueueExchange / readExchangeQueue", () => {
  it("登録した項目を id 付きで読み出せる", async () => {
    const entry = await enqueueExchange(item(USER_A));

    expect(entry.id).toBeTruthy();
    const queue = await readExchangeQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({
      friendId: USER_A,
      qrToken: `qt-${USER_A}`,
      miniMeishi: { username: `name-${USER_A}` },
      scannedAt: "2026-11-21T10:00:00.000Z",
    });
  });

  it("scannedAt を省略すると登録時刻がスタンプされる", async () => {
    const entry = await enqueueExchange({
      friendId: USER_A,
      offlineToken: "ot-a",
    });

    expect(entry.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("同じ相手の再スキャンは新しい項目で置き換える", async () => {
    await enqueueExchange(
      item(USER_A, { scannedAt: "2026-11-21T10:00:00.000Z" }),
    );
    await enqueueExchange(
      item(USER_A, {
        scannedAt: "2026-11-21T11:00:00.000Z",
        offlineToken: "newer-ot",
      }),
    );

    const queue = await readExchangeQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].scannedAt).toBe("2026-11-21T11:00:00.000Z");
    expect(queue[0].offlineToken).toBe("newer-ot");
  });

  it("壊れた JSON・配列以外・不正な項目は空キュー扱いにする", async () => {
    await AsyncStorage.setItem("exchangeQueue:v1", "{broken json");
    expect(await readExchangeQueue()).toEqual([]);

    await AsyncStorage.setItem("exchangeQueue:v1", JSON.stringify({ a: 1 }));
    expect(await readExchangeQueue()).toEqual([]);

    await AsyncStorage.setItem(
      "exchangeQueue:v1",
      JSON.stringify([
        { ...item(USER_A), id: "ok-1" },
        { friendId: USER_B }, // id / scannedAt 欠落
      ]),
    );
    const queue = await readExchangeQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0].friendId).toBe(USER_A);
  });
});

describe("flushExchangeQueue", () => {
  const queueItems = async (...items: NewExchangeQueueItem[]) => {
    for (const entry of items) {
      await enqueueExchange(entry);
    }
  };
  it("先頭から順に送り、成立した項目をキューから外す", async () => {
    await queueItems(item(USER_A), item(USER_B));
    const order: string[] = [];

    const result = await flushExchangeQueue({
      send: async (entry) => {
        order.push(entry.friendId);
        return "sent";
      },
    });

    expect(order).toEqual([USER_A, USER_B]);
    expect(result.sent.map((entry) => entry.friendId)).toEqual([
      USER_A,
      USER_B,
    ]);
    expect(result.remaining).toBe(0);
    expect(await readExchangeQueue()).toEqual([]);
  });

  it("期限切れ・無効（discard）の項目は破棄して報告する", async () => {
    await queueItems(item(USER_A), item(USER_B));
    const result = await flushExchangeQueue({
      send: async (entry) => (entry.friendId === USER_A ? "discard" : "sent"),
    });

    expect(result.discarded.map((entry) => entry.friendId)).toEqual([USER_A]);
    expect(await readExchangeQueue()).toEqual([]);
  });

  it("送信できない（retry）とその項目を残して後続も打ち切る", async () => {
    await queueItems(item(USER_A), item(USER_B));
    const sentTo: string[] = [];

    const result = await flushExchangeQueue({
      send: async (entry) => {
        sentTo.push(entry.friendId);
        return "retry";
      },
    });

    // オフライン中に後続を試しても同じく失敗するため、1 件目で打ち切る。
    expect(sentTo).toEqual([USER_A]);
    expect(result.remaining).toBe(2);
    expect(await readExchangeQueue()).toHaveLength(2);
  });

  it("send が例外を投げても retry 扱いで残す", async () => {
    await queueItems(item(USER_A));
    const result = await flushExchangeQueue({
      send: async () => {
        throw new TypeError("Network request failed");
      },
    });

    expect(result.remaining).toBe(1);
    expect(await readExchangeQueue()).toHaveLength(1);
  });

  it("flush 中に追加された項目を消さない", async () => {
    await queueItems(item(USER_A));
    // USER_A の送信と並行して USER_B がキューへ積まれた想定。
    // 差分削除なので、flush 開始時の一覧に無かった項目は残る。
    const result = await flushExchangeQueue({
      send: async (entry) => {
        await enqueueExchange(item(USER_B));
        return "sent";
      },
    });

    expect(result.sent.map((entry) => entry.friendId)).toEqual([USER_A]);
    const queue = await readExchangeQueue();
    expect(queue.map((entry) => entry.friendId)).toEqual([USER_B]);
  });
});
