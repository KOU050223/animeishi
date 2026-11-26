import { cleanup } from "@testing-library/react-native";
import { QueryClient } from "@tanstack/react-query";

type QueryClientConfig = ConstructorParameters<typeof QueryClient>[0];

const clients = new Set<QueryClient>();

export function createTestQueryClient(config?: QueryClientConfig) {
  const client = new QueryClient(config);
  clients.add(client);
  return client;
}

// QueryClient はクエリ・ミューテーションごとに gcTime のタイマーを抱える。
// gcTime を一律 0 にするとキャッシュの残る振る舞いを検証できないため、
// 生成したクライアントをここに集めてテスト後にタイマーごと破棄する。
afterEach(async () => {
  await cleanup();
  for (const client of clients) {
    // mutationCache の clear()/remove() は GC タイマーを止めない
    // （queryCache 側は query.destroy() する非対称）ため、先に各 Mutation を
    // destroy() する。
    client
      .getMutationCache()
      .getAll()
      .forEach((mutation) => mutation.destroy());
    client.clear();
  }
  clients.clear();
});
