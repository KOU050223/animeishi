export const useAuth = () => ({
  getToken: async () => null,
  isSignedIn: false,
});

export const useUser = () => ({ user: null, isLoaded: true });
export const ClerkProvider = ({ children }: { children: unknown }) => children;
export const useSignIn = () => ({
  signIn: null,
  setActive: null,
  isLoaded: true,
});
export const useSignUp = () => ({
  signUp: null,
  setActive: null,
  isLoaded: true,
});
