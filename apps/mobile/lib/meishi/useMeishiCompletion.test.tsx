import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useMeishiCompletion } from "@/lib/meishi/useMeishiCompletion";
import type { MeishiCardData, MeishiDocument, MeishiLibrary } from "./types";

// 実ストレージ（AsyncStorage は jest 環境でメモリ実装）を通して
// reload がドキュメントを読み直すことを検証する。
// プロフィール・推しの取得は API 依存なのでモックにする。

const LIBRARY_KEY = "meishi-library:v1";

const sampleDoc: MeishiDocument = {
  version: 1,
  canvas: {
    aspectRatio: 1.6,
    background: { kind: "solid", color: "#ffffff" },
  },
  elements: [],
};

function libraryFixture(cards: MeishiCardData[]): MeishiLibrary {
  return { version: 1, cards, defaultCardId: cards[0]?.id ?? null };
}

async function seedLibrary(library: MeishiLibrary) {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
}

jest.mock("@/lib/useProfile", () => ({
  useProfile: () => ({
    data: {
      username: "ユーザー",
      profileImageUrl: "https://example.com/a.png",
    },
    isLoading: false,
  }),
}));

jest.mock("@/lib/useFavorites", () => ({
  useFavorites: () => ({ data: [1, 2, 3], isLoading: false }),
}));

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("useMeishiCompletion", () => {
  it("既定カードにドキュメントが無ければ template が未達になる", async () => {
    const { result } = await renderHook(() => useMeishiCompletion());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.missing).toContain("template");
    expect(result.current.document).toBeNull();
  });

  it("reload で保存済みの既定カードを読み直して template が達成になる", async () => {
    const { result } = await renderHook(() => useMeishiCompletion());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isComplete).toBe(false);

    // 名刺エディタでの保存に相当する状態をストレージに作る
    await seedLibrary(
      libraryFixture([
        {
          id: "card-a",
          name: "名刺 1",
          document: sampleDoc,
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
    await act(() => result.current.reload());

    expect(result.current.document).toEqual(sampleDoc);
    expect(result.current.missing).not.toContain("template");
    expect(result.current.isComplete).toBe(true);
  });
});
