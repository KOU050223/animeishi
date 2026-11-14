import React from "react";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  WATCH_HISTORY_QUERY_KEY,
  WATCH_STATUS_LABELS,
  useDeleteWatchHistory,
  useUpsertWatchHistory,
  useWatchHistory,
} from "@/lib/useWatchHistory";
import { WORK_DETAIL_QUERY_KEY, useWorkDetail } from "@/lib/useWorkDetail";
import { ApiRequestError } from "@/lib/apiError";
import { loggedInUser, resetAuth } from "@/test-utils/auth";
import { setMockClerkState } from "../__mocks__/@clerk/expo";

const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockGetHistories = jest.fn();
const mockGetWork = jest.fn();
jest.mock("@/lib/api", () => ({
  apiClient: {
    me: {
      "watch-histories": {
        $get: (...args: unknown[]) => mockGetHistories(...args),
        ":annictWorkId": {
          $put: (...args: unknown[]) => mockPut(...args),
          $delete: (...args: unknown[]) => mockDelete(...args),
        },
      },
    },
    works: {
      ":annictWorkId": {
        $get: (...args: unknown[]) => mockGetWork(...args),
      },
    },
  },
}));

// useWatchHistory の import 元（barrel）。連携状態は常に連携済み、
// Annict 認証ヘッダは空でよい（apiClient 側はモック済み）。
jest.mock("@/lib/annict", () => ({
  buildAnnictAuthHeader: async () => ({}),
  useAnnictConnection: () => ({ isConnected: true, isLoading: false }),
}));

describe("WATCH_STATUS_LABELS", () => {
  it("全ステータスに日本語ラベルが定義されている", async () => {
    expect(WATCH_STATUS_LABELS.WATCHING).toBe("視聴中");
    expect(WATCH_STATUS_LABELS.WATCHED).toBe("視聴済");
    expect(WATCH_STATUS_LABELS.ON_HOLD).toBe("一時停止");
    expect(WATCH_STATUS_LABELS.STOP_WATCHING).toBe("断念");
    expect(WATCH_STATUS_LABELS.WANNA_WATCH).toBe("視聴予定");
  });
});

describe("useUpsertWatchHistory の楽観的更新", () => {
  const userId = "user_test";
  const queryKey = [...WATCH_HISTORY_QUERY_KEY, userId];

  const seedHistory = () => [
    { annictWorkId: 1, title: "作品A", state: "WATCHING" },
    { annictWorkId: 2, title: "作品B", state: "ON_HOLD" },
  ];

  function createWrapper(client: QueryClient) {
    return function wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  function getStates(client: QueryClient) {
    return client.getQueryData<Array<{ annictWorkId: number; state: string }>>(
      queryKey,
    );
  }

  // QueryClient はクエリ・ミューテーションごとに gcTime（既定5分）のタイマーを
  // 抱えるため、放置すると Jest が終了しない。アンマウントで mutation が
  // unused 化して GC タイマーが起きるので cleanup() の後で止める。
  // mutationCache の clear()/remove() はタイマーを止めない
  // （queryCache 側は query.destroy() する非対称）ため、各 Mutation を
  // destroy() してから client.clear() する。
  let client: QueryClient;
  beforeEach(async () => {
    resetAuth();
    jest.clearAllMocks();
    loggedInUser({ userId });
    setMockClerkState({ getToken: async () => "test-token" });
    client = new QueryClient();
  });

  afterEach(async () => {
    await cleanup();
    client
      .getMutationCache()
      .getAll()
      .forEach((m) => m.destroy());
    client.clear();
  });

  it("API 応答を待たずキャッシュのステータスを先に書き換える", async () => {
    client.setQueryData(queryKey, seedHistory());
    // PUT を保留させて「応答前」のキャッシュを検証する。
    let resolvePut: (v: unknown) => void = () => {};
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePut = resolve;
        }),
    );

    const { result } = await renderHook(() => useUpsertWatchHistory(), {
      wrapper: createWrapper(client),
    });

    await act(() => {
      result.current.mutate({
        annictWorkId: 1,
        data: { state: "WATCHED" },
      });
    });

    await waitFor(() => expect(getStates(client)?.[0].state).toBe("WATCHED"));
    // 対象外の作品は書き換わらない。
    expect(getStates(client)?.[1].state).toBe("ON_HOLD");

    await act(async () => {
      resolvePut({ ok: true, json: async () => ({}) });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // settle 後はサーバーの正データを取り直すためクエリが無効化される。
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("更新が失敗したら楽観値をロールバックする", async () => {
    client.setQueryData(queryKey, seedHistory());
    mockPut.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = await renderHook(() => useUpsertWatchHistory(), {
      wrapper: createWrapper(client),
    });

    await act(() => {
      result.current.mutate({
        annictWorkId: 1,
        data: { state: "WATCHED" },
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getStates(client)?.[0].state).toBe("WATCHING");
    expect(getStates(client)?.[1].state).toBe("ON_HOLD");
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("別作品への連続編集中に片方が失敗しても、もう片方の楽観表示を巻き戻さない", async () => {
    client.setQueryData(queryKey, seedHistory());
    const resolvers: Array<(v: unknown) => void> = [];
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result } = await renderHook(() => useUpsertWatchHistory(), {
      wrapper: createWrapper(client),
    });

    // 作品A・作品B の更新を両方 API 応答保留中に発行する。
    await act(() => {
      result.current.mutate({ annictWorkId: 1, data: { state: "WATCHED" } });
      result.current.mutate({ annictWorkId: 2, data: { state: "WATCHED" } });
    });
    await waitFor(() => {
      expect(getStates(client)?.[0].state).toBe("WATCHED");
      expect(getStates(client)?.[1].state).toBe("WATCHED");
    });

    // A 側だけ失敗させる → A だけロールバックし、B の楽観表示は維持される。
    await act(async () => {
      resolvers[0]({ ok: false, status: 500, json: async () => ({}) });
    });
    await waitFor(() => expect(getStates(client)?.[0].state).toBe("WATCHING"));
    expect(getStates(client)?.[1].state).toBe("WATCHED");

    // upsert はスコープで直列化されているため、B の PUT は A の settle 後に走る。
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => {
      resolvers[1]({ ok: true, json: async () => ({}) });
    });
  });

  it("同じ作品に後続の更新が乗っている場合はロールバックしない", async () => {
    client.setQueryData(queryKey, seedHistory());
    const resolvers: Array<(v: unknown) => void> = [];
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result } = await renderHook(() => useUpsertWatchHistory(), {
      wrapper: createWrapper(client),
    });

    // 同一作品へ WATCHED → ON_HOLD と続けて発行し、1 回目だけ失敗させる。
    await act(() => {
      result.current.mutate({ annictWorkId: 1, data: { state: "WATCHED" } });
      result.current.mutate({ annictWorkId: 1, data: { state: "ON_HOLD" } });
    });
    await waitFor(() => expect(getStates(client)?.[0].state).toBe("ON_HOLD"));

    await act(async () => {
      resolvers[0]({ ok: false, status: 500, json: async () => ({}) });
    });
    // 1 回目の失敗で 2 回目の楽観値（ユーザーの最新の意図）を巻き戻さない。
    expect(getStates(client)?.[0].state).toBe("ON_HOLD");

    // スコープで直列化されているため、2 回目の PUT は 1 回目の settle 後に走る。
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => {
      resolvers[1]({ ok: true, json: async () => ({}) });
    });
  });

  it("連続した更新はスコープにより直列で実行される", async () => {
    client.setQueryData(queryKey, seedHistory());
    const resolvers: Array<(v: unknown) => void> = [];
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result } = await renderHook(() => useUpsertWatchHistory(), {
      wrapper: createWrapper(client),
    });

    await act(() => {
      result.current.mutate({ annictWorkId: 1, data: { state: "WATCHED" } });
      result.current.mutate({ annictWorkId: 1, data: { state: "ON_HOLD" } });
    });

    // 応答順の入れ替わりで古い選択がサーバーの最終状態になるのを防ぐため、
    // 2 件目の PUT は 1 件目が settle するまで開始されない。
    await waitFor(() => expect(resolvers).toHaveLength(1));

    await act(async () => {
      resolvers[0]({ ok: true, json: async () => ({}) });
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));
  });

  it("他の更新が残っている間は再取得を保留する", async () => {
    client.setQueryData(queryKey, seedHistory());
    const resolvers: Array<(v: unknown) => void> = [];
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result } = await renderHook(() => useUpsertWatchHistory(), {
      wrapper: createWrapper(client),
    });

    await act(() => {
      result.current.mutate({ annictWorkId: 1, data: { state: "WATCHED" } });
      result.current.mutate({ annictWorkId: 2, data: { state: "WATCHED" } });
    });
    await waitFor(() => expect(resolvers).toHaveLength(1));

    // A が先に settle しても B の PUT はまだ残っているため再取得しない
    // （再取得すると B の PUT 未反映の一覧でキャッシュが上書きされ、
    // B の楽観値が一瞬巻き戻る）。
    await act(async () => {
      resolvers[0]({ ok: true, json: async () => ({}) });
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    expect(client.getQueryState(queryKey)?.isInvalidated ?? false).toBe(false);

    // B が settle してキューが空になった時点で初めて無効化される。
    await act(async () => {
      resolvers[1]({ ok: true, json: async () => ({}) });
    });
    await waitFor(() =>
      expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true),
    );
  });

  it("失敗応答の code を ApiRequestError に載せる", async () => {
    client.setQueryData(queryKey, seedHistory());
    // Annict トークン未登録の 401 応答（requireAnnictToken）を再現する。
    mockPut.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({
        error: "Annict 連携が必要です",
        code: "annict_token_required",
      }),
    });

    const { result } = await renderHook(() => useUpsertWatchHistory(), {
      wrapper: createWrapper(client),
    });

    await act(() => {
      result.current.mutate({
        annictWorkId: 1,
        data: { state: "WATCHED" },
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiRequestError);
    expect((result.current.error as ApiRequestError).code).toBe(
      "annict_token_required",
    );
  });

  it("キャッシュに無い作品を更新しても既存データを壊さない", async () => {
    client.setQueryData(queryKey, seedHistory());
    mockPut.mockResolvedValue({ ok: true, json: async () => ({}) });

    const { result } = await renderHook(() => useUpsertWatchHistory(), {
      wrapper: createWrapper(client),
    });

    await act(() => {
      result.current.mutate({
        annictWorkId: 999,
        data: { state: "WATCHED" },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getStates(client)).toEqual(seedHistory());
  });
});

describe("useDeleteWatchHistory の楽観的更新", () => {
  const userId = "user_test";
  const queryKey = [...WATCH_HISTORY_QUERY_KEY, userId];

  const seedHistory = () => [
    { annictWorkId: 1, title: "作品A", state: "WATCHING" },
    { annictWorkId: 2, title: "作品B", state: "ON_HOLD" },
  ];

  function createWrapper(client: QueryClient) {
    return function wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  function getStates(client: QueryClient) {
    return client.getQueryData<Array<{ annictWorkId: number; state: string }>>(
      queryKey,
    );
  }

  let client: QueryClient;
  beforeEach(async () => {
    resetAuth();
    jest.clearAllMocks();
    loggedInUser({ userId });
    setMockClerkState({ getToken: async () => "test-token" });
    client = new QueryClient();
  });

  afterEach(async () => {
    await cleanup();
    client
      .getMutationCache()
      .getAll()
      .forEach((m) => m.destroy());
    client.clear();
  });

  it("API 応答を待たずキャッシュから行を先に消す", async () => {
    client.setQueryData(queryKey, seedHistory());
    let resolveDelete: (v: unknown) => void = () => {};
    mockDelete.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDelete = resolve;
        }),
    );

    const { result } = await renderHook(() => useDeleteWatchHistory(), {
      wrapper: createWrapper(client),
    });

    await act(() => {
      result.current.mutate(1);
    });

    await waitFor(() =>
      expect(getStates(client)?.map((i) => i.annictWorkId)).toEqual([2]),
    );

    await act(async () => {
      resolveDelete({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("削除が失敗したら消した行を元の位置に戻す", async () => {
    client.setQueryData(queryKey, seedHistory());
    mockDelete.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = await renderHook(() => useDeleteWatchHistory(), {
      wrapper: createWrapper(client),
    });

    await act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(getStates(client)?.map((i) => i.annictWorkId)).toEqual([1, 2]);
    expect(getStates(client)?.[0].state).toBe("WATCHING");
    // 巻き戻したことがエラーに記録される（「元の状態に戻しました」の判定用）。
    const error = result.current.error as { rolledBack?: boolean } | null;
    expect(error?.rolledBack).toBe(true);
    expect(client.getQueryState(queryKey)?.isInvalidated).toBe(true);
  });

  it("upsert と同じスコープで直列化される（解除 → 再設定の順序を保つ）", async () => {
    client.setQueryData(queryKey, seedHistory());
    const resolvers: Array<(v: unknown) => void> = [];
    mockDelete.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(resolve);
        }),
    );

    const { result } = await renderHook(
      () => ({
        remove: useDeleteWatchHistory(),
        upsert: useUpsertWatchHistory(),
      }),
      { wrapper: createWrapper(client) },
    );

    // 解除の直後に別ステータスを設定しても、DELETE が settle するまで
    // PUT は始まらない（順序が入れ替わると最終状態が意図と逆になる）。
    await act(() => {
      result.current.remove.mutate(1);
      result.current.upsert.mutate({
        annictWorkId: 1,
        data: { state: "WATCHED" },
      });
    });
    await waitFor(() => expect(resolvers).toHaveLength(1));

    await act(async () => {
      resolvers[0]({
        ok: true,
        headers: { get: () => "application/json" },
        json: async () => ({ success: true }),
      });
    });
    await waitFor(() => expect(resolvers).toHaveLength(2));
    await act(async () => {
      resolvers[1]({ ok: true, json: async () => ({}) });
    });
  });

  it("キャッシュに対象行が無くても失敗時は rolledBack=true が付く", async () => {
    // 一覧未取得のまま作品詳細シートから解除したケース。
    // 消した行が無いので巻き戻す必要がなく、表示は元のまま＝rolledBack=true。
    mockDelete.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const { result } = await renderHook(() => useDeleteWatchHistory(), {
      wrapper: createWrapper(client),
    });

    await act(() => {
      result.current.mutate(1);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    const error = result.current.error as { rolledBack?: boolean } | null;
    expect(error?.rolledBack).toBe(true);
  });
});

describe("useWatchHistory 取得時の作品詳細キャッシュ整合", () => {
  const userId = "user_test";
  const detailKey = (annictWorkId: number) => [
    ...WORK_DETAIL_QUERY_KEY,
    userId,
    annictWorkId,
  ];

  function createWrapper(client: QueryClient) {
    return function wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  let client: QueryClient;
  beforeEach(async () => {
    resetAuth();
    jest.clearAllMocks();
    loggedInUser({ userId });
    setMockClerkState({ getToken: async () => "test-token" });
    client = new QueryClient();
  });

  afterEach(async () => {
    await cleanup();
    client
      .getMutationCache()
      .getAll()
      .forEach((m) => m.destroy());
    client.clear();
  });

  it("同期後の履歴と state が食い違う詳細キャッシュだけを無効化する", async () => {
    client.setQueryData(detailKey(1), {
      work: { annictWorkId: 1, state: "WATCHED" },
    });
    client.setQueryData(detailKey(2), {
      work: { annictWorkId: 2, state: "WATCHED" },
    });
    // 別ユーザーの詳細キャッシュは本人の履歴と突き合わせない。
    client.setQueryData([...WORK_DETAIL_QUERY_KEY, "other_user", 1], {
      work: { annictWorkId: 1, state: "WATCHED" },
    });
    mockGetHistories.mockResolvedValue({
      ok: true,
      json: async () => [
        { annictWorkId: 1, title: "作品A", state: "WATCHING" },
        { annictWorkId: 2, title: "作品B", state: "WATCHED" },
      ],
    });

    const { result } = await renderHook(() => useWatchHistory(), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 履歴が WATCHING に同期されたのに WATCHED のままの詳細だけ無効化。
    expect(client.getQueryState(detailKey(1))?.isInvalidated).toBe(true);
    // 一致している詳細キャッシュは触らない（表示中のシートを再取得させない）。
    expect(client.getQueryState(detailKey(2))?.isInvalidated ?? false).toBe(
      false,
    );
    expect(
      client.getQueryState([...WORK_DETAIL_QUERY_KEY, "other_user", 1])
        ?.isInvalidated ?? false,
    ).toBe(false);
  });

  it("履歴から消えた（ステータス解除された）作品の詳細キャッシュも無効化する", async () => {
    client.setQueryData(detailKey(9), {
      work: { annictWorkId: 9, state: "WATCHING" },
    });
    mockGetHistories.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const { result } = await renderHook(() => useWatchHistory(), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryState(detailKey(9))?.isInvalidated).toBe(true);
  });
});

describe("useWorkDetail 取得時の履歴キャッシュ追従", () => {
  const userId = "user_test";
  const queryKey = [...WATCH_HISTORY_QUERY_KEY, userId];

  function createWrapper(client: QueryClient) {
    return function wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      );
    };
  }

  function getStates(client: QueryClient) {
    return client.getQueryData<Array<{ annictWorkId: number; state: string }>>(
      queryKey,
    );
  }

  let client: QueryClient;
  beforeEach(async () => {
    resetAuth();
    jest.clearAllMocks();
    loggedInUser({ userId });
    setMockClerkState({ getToken: async () => "test-token" });
    client = new QueryClient();
  });

  afterEach(async () => {
    await cleanup();
    client
      .getMutationCache()
      .getAll()
      .forEach((m) => m.destroy());
    client.clear();
  });

  it("詳細の方が新しい state なら履歴キャッシュの該当行を書き換える", async () => {
    client.setQueryData(queryKey, [
      { annictWorkId: 1, title: "作品A", state: "WATCHED" },
      { annictWorkId: 2, title: "作品B", state: "ON_HOLD" },
    ]);
    mockGetWork.mockResolvedValue({
      ok: true,
      json: async () => ({ work: { annictWorkId: 1, state: "WATCHING" } }),
    });

    const { result } = await renderHook(() => useWorkDetail(1), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // 詳細シートと一覧が同じステータスを出すように履歴側へ追従させる。
    expect(getStates(client)?.[0].state).toBe("WATCHING");
    expect(getStates(client)?.[1].state).toBe("ON_HOLD");
  });

  it("詳細の state が null（解除済み）なら履歴キャッシュから行を除く", async () => {
    client.setQueryData(queryKey, [
      { annictWorkId: 1, title: "作品A", state: "WATCHED" },
      { annictWorkId: 2, title: "作品B", state: "WATCHING" },
    ]);
    mockGetWork.mockResolvedValue({
      ok: true,
      json: async () => ({ work: { annictWorkId: 1, state: null } }),
    });

    const { result } = await renderHook(() => useWorkDetail(1), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getStates(client)?.map((i) => i.annictWorkId)).toEqual([2]);
  });

  it("履歴キャッシュに無い作品は行を捏造しない", async () => {
    client.setQueryData(queryKey, [
      { annictWorkId: 2, title: "作品B", state: "WATCHING" },
    ]);
    mockGetWork.mockResolvedValue({
      ok: true,
      json: async () => ({ work: { annictWorkId: 1, state: "WATCHING" } }),
    });

    const { result } = await renderHook(() => useWorkDetail(1), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getStates(client)?.map((i) => i.annictWorkId)).toEqual([2]);
  });

  it("部分追従しても履歴クエリの取得時刻は維持される（全件同期の鮮度を上げない）", async () => {
    // stale な履歴を古い dataUpdatedAt で再現する。部分書き換えで取得時刻が
    // 更新されると、ライブラリ側が fresh と誤認して全件同期を省いてしまう。
    const past = Date.now() - 10 * 60 * 1000;
    client.setQueryData(
      queryKey,
      [{ annictWorkId: 1, title: "作品A", state: "WATCHED" }],
      { updatedAt: past },
    );
    mockGetWork.mockResolvedValue({
      ok: true,
      json: async () => ({ work: { annictWorkId: 1, state: "WATCHING" } }),
    });

    const { result } = await renderHook(() => useWorkDetail(1), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(getStates(client)?.[0].state).toBe("WATCHING");
    expect(client.getQueryState(queryKey)?.dataUpdatedAt).toBe(past);
  });

  it("詳細と一致する履歴では取得時刻もデータも変えない", async () => {
    const past = Date.now() - 10 * 60 * 1000;
    client.setQueryData(
      queryKey,
      [{ annictWorkId: 1, title: "作品A", state: "WATCHING" }],
      { updatedAt: past },
    );
    mockGetWork.mockResolvedValue({
      ok: true,
      json: async () => ({ work: { annictWorkId: 1, state: "WATCHING" } }),
    });

    const { result } = await renderHook(() => useWorkDetail(1), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryState(queryKey)?.dataUpdatedAt).toBe(past);
  });

  it("履歴キャッシュに無い作品の詳細でも取得時刻は変わらない", async () => {
    const past = Date.now() - 10 * 60 * 1000;
    client.setQueryData(
      queryKey,
      [{ annictWorkId: 2, title: "作品B", state: "WATCHING" }],
      { updatedAt: past },
    );
    mockGetWork.mockResolvedValue({
      ok: true,
      json: async () => ({ work: { annictWorkId: 1, state: "WATCHING" } }),
    });

    const { result } = await renderHook(() => useWorkDetail(1), {
      wrapper: createWrapper(client),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(client.getQueryState(queryKey)?.dataUpdatedAt).toBe(past);
  });

  it("履歴の書き込みミューテーション中は履歴キャッシュを上書きしない", async () => {
    client.setQueryData(queryKey, [
      { annictWorkId: 1, title: "作品A", state: "WATCHED" },
    ]);
    // PUT を保留して「書き込み中」を作る。この間に詳細が返っても
    // 楽観値（ON_HOLD）を viewerStatusState（WATCHING）で上書きしない。
    let resolvePut: (v: unknown) => void = () => {};
    mockPut.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePut = resolve;
        }),
    );
    mockGetWork.mockResolvedValue({
      ok: true,
      json: async () => ({ work: { annictWorkId: 1, state: "WATCHING" } }),
    });

    const { result } = await renderHook(
      () => ({
        upsert: useUpsertWatchHistory(),
        detail: useWorkDetail(1),
      }),
      { wrapper: createWrapper(client) },
    );

    await act(() => {
      result.current.upsert.mutate({
        annictWorkId: 1,
        data: { state: "ON_HOLD" },
      });
    });
    await waitFor(() => expect(getStates(client)?.[0].state).toBe("ON_HOLD"));
    await waitFor(() => expect(result.current.detail.isSuccess).toBe(true));

    expect(getStates(client)?.[0].state).toBe("ON_HOLD");
    await act(async () => {
      resolvePut({ ok: true, json: async () => ({}) });
    });
  });
});
