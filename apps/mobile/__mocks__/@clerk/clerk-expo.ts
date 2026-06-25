/**
 * Clerk (@clerk/clerk-expo) のテスト用モック。
 *
 * jest.config.js の moduleNameMapper でテスト中は常にこのファイルが
 * @clerk/clerk-expo の代わりに読み込まれる。各テストが個別に jest.mock を
 * 書かなくて済むよう、認証状態を可変ステートとして保持し、テスト側からは
 * test-utils/auth.ts の loggedInUser() / signedOutUser() で差し替える。
 *
 * 直接このファイルの setMockClerkState を呼んでもよいが、可読性のため
 * 通常はファクトリ（loggedInUser 等）経由での利用を推奨する。
 */

type MockClerkState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: { id: string; username: string | null } | null;
  getToken: () => Promise<string | null>;
  signOut: jest.Mock;
  setActive: jest.Mock;
  signIn: {
    create: jest.Mock;
  };
  signUp: {
    create: jest.Mock;
    prepareEmailAddressVerification: jest.Mock;
    attemptEmailAddressVerification: jest.Mock;
  };
};

function createDefaultState(): MockClerkState {
  return {
    isLoaded: true,
    isSignedIn: false,
    userId: null,
    user: null,
    getToken: async () => null,
    signOut: jest.fn(async () => {
      // 既定では signOut でクライアント状態を未サインインへ遷移させる。
      state.isSignedIn = false;
      state.userId = null;
      state.user = null;
    }),
    setActive: jest.fn(async () => {
      // 既定では setActive でサインイン済みへ遷移させる。
      state.isSignedIn = true;
    }),
    signIn: { create: jest.fn() },
    signUp: {
      create: jest.fn(),
      prepareEmailAddressVerification: jest.fn(),
      attemptEmailAddressVerification: jest.fn(),
    },
  };
}

let state: MockClerkState = createDefaultState();

/** 現在のモックステートを取得する（アサーション用）。 */
export function getMockClerkState(): MockClerkState {
  return state;
}

/** モックステートを部分更新する。test-utils の各ファクトリから利用する。 */
export function setMockClerkState(patch: Partial<MockClerkState>): void {
  state = { ...state, ...patch };
}

/**
 * モックステートを初期状態（未サインイン・新しい jest.fn 群）へ戻す。
 * beforeEach から呼ぶ。jest.clearAllMocks() では参照を作り直さないため、
 * テスト間で create.mockResolvedValueOnce のキューが残らないよう再生成する。
 */
export function resetMockClerkState(): void {
  state = createDefaultState();
}

// --- @clerk/clerk-expo が公開しているフック群（モック実装） ---

export const useAuth = () => ({
  isLoaded: state.isLoaded,
  isSignedIn: state.isSignedIn,
  userId: state.userId,
  getToken: state.getToken,
  signOut: state.signOut,
});

export const useUser = () => ({
  user: state.user,
  isLoaded: state.isLoaded,
});

export const useSignIn = () => ({
  signIn: state.signIn,
  setActive: state.setActive,
  isLoaded: state.isLoaded,
});

export const useSignUp = () => ({
  signUp: state.signUp,
  setActive: state.setActive,
  isLoaded: state.isLoaded,
});

export const ClerkProvider = ({ children }: { children: unknown }) => children;
