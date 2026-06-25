/**
 * テストで認証状態を「どこからでも一行で」表現するためのファクトリ。
 *
 * jest.config.js の moduleNameMapper により @clerk/clerk-expo は常に
 * __mocks__/@clerk/clerk-expo.ts に解決される。ここではそのモックステートを
 * 意図が読める名前で差し替えるだけのシン・ラッパーを提供する。
 *
 * 使い方:
 *   import { loggedInUser, signedOutUser, resetAuth } from "@/test-utils/auth";
 *
 *   beforeEach(() => resetAuth());
 *
 *   it("ログイン済みなら…", () => {
 *     loggedInUser();           // これだけでサインイン済み状態になる
 *     render(<SomeScreen />);
 *   });
 */
// 型・実装ともにモック本体を直接参照する。moduleNameMapper はランタイム解決
// のみで型を伴わないため、ヘルパー API（getMockClerkState 等）は本物の
// @clerk/clerk-expo の型には存在せず、相対 import が必要。
import {
  getMockClerkState,
  resetMockClerkState,
  setMockClerkState,
} from "../__mocks__/@clerk/clerk-expo";

type LoggedInOptions = {
  userId?: string;
  username?: string | null;
};

/**
 * サインイン済みユーザーを表現する。
 * @returns モックステート（signOut 等の jest.Mock を直接アサートしたいとき用）
 */
export function loggedInUser(options: LoggedInOptions = {}) {
  const userId = options.userId ?? "user_test";
  const username = options.username ?? "testuser";
  setMockClerkState({
    isSignedIn: true,
    userId,
    user: { id: userId, username },
  });
  return getMockClerkState();
}

/**
 * 未サインイン状態を表現する（既定状態と同じだが、意図を明示したいとき用）。
 */
export function signedOutUser() {
  setMockClerkState({ isSignedIn: false, userId: null, user: null });
  return getMockClerkState();
}

/**
 * Clerk がまだ読み込み中（isLoaded: false）の状態を表現する。
 * AuthGuard や各画面の早期 return をテストしたいとき用。
 */
export function authLoading() {
  setMockClerkState({ isLoaded: false });
  return getMockClerkState();
}

/**
 * 認証モックを初期状態（未サインイン・新しい jest.fn 群）へ戻す。
 * 各テストの beforeEach で呼ぶ。
 */
export function resetAuth() {
  resetMockClerkState();
}

/** 現在の認証モックステートを取得する（アサーション用）。 */
export function getAuthMock() {
  return getMockClerkState();
}
