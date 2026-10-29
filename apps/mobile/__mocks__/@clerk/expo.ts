/**
 * Clerk (@clerk/expo) のテスト用モック。
 *
 * jest.config.cjs の moduleNameMapper でテスト中は常にこのファイルが
 * @clerk/expo の代わりに読み込まれる。各テストが個別に jest.mock を
 * 書かなくて済むよう、認証状態を可変ステートとして保持し、テスト側からは
 * test-utils/auth.ts の loggedInUser() / signedOutUser() で差し替える。
 *
 * 直接このファイルの setMockClerkState を呼んでもよいが、可読性のため
 * 通常はファクトリ（loggedInUser 等）経由での利用を推奨する。
 *
 * Core 3 のシグナル API（useSignIn / useSignUp）に合わせた形:
 * 各メソッドは例外ではなく `{ error }` を返し、成否は戻り値ではなく
 * リソース（signIn / signUp オブジェクト）の status 等に反映される。
 * テストで結果を設定するには、呼び出し前にリソースの `outcome` フィールドへ
 * 反映したい値を入れる（次のメソッド呼び出しでリソースへ適用され、
 * `{ error }` の値にもなる）。単発の戻り値を差し替えたいだけなら
 * 通常どおり mockResolvedValueOnce({ error: ... }) も使える。
 */

type MockUser = {
  id: string;
  username: string | null;
  passkeys: Array<{ id: string }>;
  createPasskey: jest.Mock;
};

/** シグナル API のリソースへ次の呼び出し時に反映する結果。 */
type MockOutcome = {
  error?: unknown;
} & Record<string, unknown>;

type MockSignIn = {
  id: string | null;
  status: string | null;
  createdSessionId: string | null;
  existingSession?: { sessionId: string };
  /** 次のメソッド呼び出し時にリソースへ反映する結果（適用後は null に戻る）。 */
  outcome: MockOutcome | null;
  password: jest.Mock;
  passkey: jest.Mock;
  sso: jest.Mock;
  finalize: jest.Mock;
};

type MockSignUp = {
  id: string | null;
  status: string | null;
  createdSessionId: string | null;
  unverifiedFields: string[];
  missingFields: string[];
  existingSession?: { sessionId: string };
  outcome: MockOutcome | null;
  password: jest.Mock;
  sso: jest.Mock;
  verifications: {
    sendEmailCode: jest.Mock;
    verifyEmailCode: jest.Mock;
  };
  finalize: jest.Mock;
};

type MockClerkState = {
  isLoaded: boolean;
  isSignedIn: boolean;
  userId: string | null;
  user: MockUser | null;
  getToken: () => Promise<string | null>;
  signOut: jest.Mock;
  setActive: jest.Mock;
  signIn: MockSignIn;
  signUp: MockSignUp;
  startSSOFlow: jest.Mock;
  handleRedirectCallback: jest.Mock;
  client: {
    sessions: Array<{ id: string }>;
    signedInSessions: Array<{ id: string }>;
    lastActiveSessionId: string | null;
  };
};

/** outcome をリソースへ適用し `{ error }` を返す、シグナル API メソッドの既定挙動。 */
function applyOutcome(resource: { outcome: MockOutcome | null }): {
  error: unknown;
} {
  const outcome = resource.outcome;
  resource.outcome = null;
  if (!outcome) return { error: null };
  const { error, ...fields } = outcome;
  Object.assign(resource, fields);
  return { error: error ?? null };
}

/** finalize() の既定挙動。本物同様、作成済みセッションを setActive で活性化する。 */
async function finalizeResource(resource: {
  outcome: MockOutcome | null;
  createdSessionId: string | null;
}): Promise<{ error: unknown }> {
  const { error } = applyOutcome(resource);
  if (error) return { error };
  await state.setActive({ session: resource.createdSessionId });
  return { error: null };
}

function createDefaultState(): MockClerkState {
  const signIn: MockSignIn = {
    id: null,
    status: null,
    createdSessionId: null,
    outcome: null,
    password: jest.fn(async () => applyOutcome(signIn)),
    // Web パスキーサインイン（#181）と Web OAuth リダイレクト（#89）のモック。
    passkey: jest.fn(async () => applyOutcome(signIn)),
    sso: jest.fn(async () => applyOutcome(signIn)),
    finalize: jest.fn(async () => finalizeResource(signIn)),
  };
  const signUp: MockSignUp = {
    id: null,
    status: null,
    createdSessionId: null,
    unverifiedFields: [],
    missingFields: [],
    outcome: null,
    password: jest.fn(async () => applyOutcome(signUp)),
    sso: jest.fn(async () => applyOutcome(signUp)),
    verifications: {
      sendEmailCode: jest.fn(async () => applyOutcome(signUp)),
      verifyEmailCode: jest.fn(async () => applyOutcome(signUp)),
    },
    finalize: jest.fn(async () => finalizeResource(signUp)),
  };
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
    signIn,
    signUp,
    // ネイティブ Google SSO（useSSO）と Web コールバック完了処理のモック。
    startSSOFlow: jest.fn(),
    handleRedirectCallback: jest.fn(),
    // session_exists 時の既存セッション復旧で参照する client 状態。
    // 既定は「セッション無し（isSignedIn=false と整合する通常状態）」。
    client: {
      sessions: [],
      signedInSessions: [],
      lastActiveSessionId: null,
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
 * テスト間で mockResolvedValueOnce のキューが残らないよう再生成する。
 */
export function resetMockClerkState(): void {
  state = createDefaultState();
}

// --- @clerk/expo が公開しているフック群（モック実装） ---

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

const emptySignInErrors = {
  fields: { identifier: null, password: null, code: null },
  raw: null,
  global: null,
};

const emptySignUpErrors = {
  fields: {
    firstName: null,
    lastName: null,
    emailAddress: null,
    phoneNumber: null,
    password: null,
    username: null,
    code: null,
    captcha: null,
    legalAccepted: null,
  },
  raw: null,
  global: null,
};

export const useSignIn = () => ({
  signIn: state.isLoaded ? state.signIn : null,
  errors: emptySignInErrors,
  fetchStatus: "idle" as const,
});

export const useSignUp = () => ({
  signUp: state.isLoaded ? state.signUp : null,
  errors: emptySignUpErrors,
  fetchStatus: "idle" as const,
});

export const useClerk = () => ({
  client: state.client,
  setActive: state.setActive,
  handleRedirectCallback: state.handleRedirectCallback,
});

// useSSO は Google 等の SSO フロー用フック（ネイティブでは
// expo-web-browser の認証セッション方式）。
export const useSSO = () => ({
  startSSOFlow: state.startSSOFlow,
});

export const ClerkProvider = ({ children }: { children: unknown }) => children;
