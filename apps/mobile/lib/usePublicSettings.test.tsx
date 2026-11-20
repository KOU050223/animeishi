import { act, renderHook } from "@testing-library/react-native";
import { usePublicSettings } from "@/lib/usePublicSettings";

const mockMutateAsync = jest.fn(async () => ({}));
let mockProfileData:
  | {
      username: string;
      bio: string | null;
      favoriteQuote: string | null;
      isPublic: boolean;
    }
  | undefined;

jest.mock("@/lib/useProfile", () => ({
  useProfile: () => ({ data: mockProfileData }),
  useUpdateProfile: () => ({ mutateAsync: mockMutateAsync }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockProfileData = {
    username: "テストユーザー",
    bio: "よろしく",
    favoriteQuote: "名言",
    isPublic: true,
  };
});

describe("usePublicSettings", () => {
  it("users.is_public の現在値を公開範囲として返す", async () => {
    expect(
      (await renderHook(() => usePublicSettings())).result.current
        .profileVisibility,
    ).toBe("public");

    mockProfileData = { ...mockProfileData!, isPublic: false };
    expect(
      (await renderHook(() => usePublicSettings())).result.current
        .profileVisibility,
    ).toBe("private");
  });

  it("「プロフィールと名刺」行の切り替えは users.is_public を更新する", async () => {
    const { result } = await renderHook(() => usePublicSettings());

    await act(() => result.current.toggle("profile", "private"));
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ isPublic: false }),
    );

    await act(() => result.current.toggle("profile", "public"));
    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ isPublic: true }),
    );
  });

  // PUT /me/profile は未送信の項目を消すため、切り替え時も取得済みの
  // プロフィール項目をすべて送る（issue #604）。
  it("切り替え時は他のプロフィール項目も現在値で送る", async () => {
    const { result } = await renderHook(() => usePublicSettings());

    await act(() => result.current.toggle("profile", "private"));

    expect(mockMutateAsync).toHaveBeenCalledWith({
      username: "テストユーザー",
      bio: "よろしく",
      favoriteQuote: "名言",
      isPublic: false,
    });
  });

  it("プロフィール未取得の状態では切り替えを保存しない", async () => {
    mockProfileData = undefined;
    const { result } = await renderHook(() => usePublicSettings());

    await expect(
      act(() => result.current.toggle("profile", "private")),
    ).rejects.toThrow();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it("一覧に無いキーの切り替えは失敗する", async () => {
    const { result } = await renderHook(() => usePublicSettings());

    await expect(
      act(() => result.current.toggle("unknown", "public")),
    ).rejects.toThrow();
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});
